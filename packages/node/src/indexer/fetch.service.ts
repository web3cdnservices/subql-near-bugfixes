// Copyright 2020-2022 OnFinality Limited authors & contributors
// SPDX-License-Identifier: Apache-2.0

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Interval, SchedulerRegistry } from '@nestjs/schedule';

import {
  isCustomDs,
  isRuntimeDataSourceV0_2_0,
  isRuntimeDataSourceV0_3_0,
  isRuntimeDs,
  NearBlockFilter,
  NearTransactionFilter,
  NearDataSource,
  NearActionFilter,
  NearHandler,
  NearHandlerKind,
  NearRuntimeHandlerFilter,
} from '@subql/common-near';
import {
  cleanedBatchBlocks,
  checkMemoryUsage,
  delay,
  getLogger,
  IndexerEvent,
  NodeConfig,
  transformBypassBlocks,
} from '@subql/node-core';
import {
  DictionaryQueryCondition,
  DictionaryQueryEntry,
  NearCustomHandler,
} from '@subql/types-near';
import { MetaData } from '@subql/utils';
import { range, sortBy, uniqBy, without } from 'lodash';
import { providers } from 'near-api-js';
import { SubqlProjectDs, SubqueryProject } from '../configure/SubqueryProject';
import { calcInterval } from '../utils/near';
import { isBaseHandler, isCustomHandler } from '../utils/project';
import { ApiService } from './api.service';
import { IBlockDispatcher } from './blockDispatcher';
import { DictionaryService } from './dictionary.service';
import { DsProcessorService } from './ds-processor.service';
import { DynamicDsService } from './dynamic-ds.service';
import { UnfinalizedBlocksService } from './unfinalizedBlocks.service';

const logger = getLogger('fetch');
let BLOCK_TIME_VARIANCE = 5000; //ms
const DICTIONARY_MAX_QUERY_SIZE = 10000;
const CHECK_MEMORY_INTERVAL = 60000;
const MINIMUM_BATCH_SIZE = 5;
const INTERVAL_PERCENT = 0.9;

function txFilterToQueryEntry(
  filter: NearTransactionFilter,
): DictionaryQueryEntry {
  const conditions: DictionaryQueryCondition[] = Object.entries(filter).map(
    ([field, value]) => ({
      field,
      value,
      matcher: 'equalTo',
    }),
  );

  return {
    entity: 'transactions',
    conditions: conditions,
  };
}

function actionFilterToQueryEntry(
  filter: NearActionFilter,
): DictionaryQueryEntry {
  const conditions: DictionaryQueryCondition[] = Object.entries(filter).map(
    ([field, value]) => ({
      field,
      value,
      matcher: 'equalTo',
    }),
  );

  return {
    entity: 'actions',
    conditions: conditions,
  };
}

@Injectable()
export class FetchService implements OnApplicationShutdown {
  private latestBestHeight: number;
  private latestFinalizedHeight: number;
  private isShutdown = false;
  private batchSizeScale: number;
  private templateDynamicDatasouces: SubqlProjectDs[];
  private dictionaryGenesisMatches = true;
  private bypassBlocks: number[] = [];
  private bypassBufferHeight: number;

  constructor(
    private apiService: ApiService,
    private nodeConfig: NodeConfig,
    @Inject('ISubqueryProject') private project: SubqueryProject,
    @Inject('IBlockDispatcher') private blockDispatcher: IBlockDispatcher,
    private dictionaryService: DictionaryService,
    private dsProcessorService: DsProcessorService,
    private dynamicDsService: DynamicDsService,
    private unfinalizedBlocksService: UnfinalizedBlocksService,
    private eventEmitter: EventEmitter2,
    private schedulerRegistry: SchedulerRegistry,
  ) {
    this.batchSizeScale = 1;
  }

  onApplicationShutdown(): void {
    try {
      this.schedulerRegistry.deleteInterval('getFinalizedBlockHead');
      this.schedulerRegistry.deleteInterval('getBestBlockHead');
    } catch (e) {
      //ignore if interval not exist
    }
    this.isShutdown = true;
  }

  get api(): providers.JsonRpcProvider {
    return this.apiService.getApi();
  }

  async syncDynamicDatascourcesFromMeta(): Promise<void> {
    this.templateDynamicDatasouces =
      await this.dynamicDsService.getDynamicDatasources();
  }

  buildDictionaryQueryEntries(startBlock: number): DictionaryQueryEntry[] {
    const queryEntries: DictionaryQueryEntry[] = [];

    const dataSources = this.project.dataSources.filter(
      (ds) => isRuntimeDataSourceV0_3_0(ds) || isRuntimeDataSourceV0_2_0(ds),
    );

    // Only run the ds that is equal or less than startBlock
    // sort array from lowest ds.startBlock to highest
    const filteredDs = dataSources
      .concat(this.templateDynamicDatasouces)
      .filter((ds) => ds.startBlock <= startBlock)
      .sort((a, b) => a.startBlock - b.startBlock);

    for (const ds of filteredDs) {
      const plugin = isCustomDs(ds)
        ? this.dsProcessorService.getDsProcessor(ds)
        : undefined;
      for (const handler of ds.mapping.handlers) {
        const baseHandlerKind = this.getBaseHandlerKind(ds, handler);
        let filterList: NearRuntimeHandlerFilter[];
        if (isCustomDs(ds)) {
          const processor = plugin.handlerProcessors[handler.kind];
          if (processor.dictionaryQuery) {
            const queryEntry = processor.dictionaryQuery(
              (handler as NearCustomHandler).filter,
              ds,
            );
            if (queryEntry) {
              queryEntries.push(queryEntry);
              continue;
            }
          }
          filterList = this.getBaseHandlerFilters<NearRuntimeHandlerFilter>(
            ds,
            handler.kind,
          );
        } else {
          filterList = [handler.filter];
        }
        // Filter out any undefined
        filterList = filterList.filter(Boolean);
        if (!filterList.length) return [];
        switch (baseHandlerKind) {
          case NearHandlerKind.Block:
            for (const filter of filterList as NearBlockFilter[]) {
              if (filter.modulo === undefined) {
                return [];
              }
            }
            break;
          case NearHandlerKind.Transaction: {
            for (const filter of filterList as NearTransactionFilter[]) {
              if (
                filter.sender !== undefined ||
                filter.receiver !== undefined
              ) {
                queryEntries.push(txFilterToQueryEntry(filter));
              } else {
                return [];
              }
            }
            break;
          }
          case NearHandlerKind.Action: {
            for (const filter of filterList as NearActionFilter[]) {
              if (filter.type !== undefined) {
                queryEntries.push(actionFilterToQueryEntry(filter));
              } else {
                return [];
              }
            }
            break;
          }
          default:
        }
      }
    }

    return uniqBy(
      queryEntries,
      (item) =>
        `${item.entity}|${JSON.stringify(
          sortBy(item.conditions, (c) => c.field),
        )}`,
    );
  }

  updateDictionary(): void {
    this.dictionaryService.buildDictionaryEntryMap<SubqlProjectDs>(
      this.project.dataSources.concat(this.templateDynamicDatasouces),
      this.buildDictionaryQueryEntries.bind(this),
    );
  }

  private get useDictionary(): boolean {
    return (
      !!this.project.network.dictionary &&
      this.dictionaryGenesisMatches &&
      !!this.dictionaryService.getDictionaryQueryEntries(
        this.blockDispatcher.latestBufferedHeight ??
          Math.min(...this.project.dataSources.map((ds) => ds.startBlock)),
      ).length
    );
  }

  async init(startHeight: number): Promise<void> {
    if (this.project.network?.bypassBlocks !== undefined) {
      this.bypassBlocks = transformBypassBlocks(
        this.project.network.bypassBlocks,
      ).filter((blk) => blk >= startHeight);
    }
    if (this.api) {
      const CHAIN_INTERVAL = calcInterval(this.api)
        .muln(INTERVAL_PERCENT)
        .toNumber();

      BLOCK_TIME_VARIANCE = Math.min(BLOCK_TIME_VARIANCE, CHAIN_INTERVAL);

      this.schedulerRegistry.addInterval(
        'getFinalizedBlockHead',
        setInterval(
          () => void this.getFinalizedBlockHead(),
          BLOCK_TIME_VARIANCE,
        ),
      );
      this.schedulerRegistry.addInterval(
        'getBestBlockHead',
        setInterval(() => void this.getBestBlockHead(), BLOCK_TIME_VARIANCE),
      );
    }

    await this.syncDynamicDatascourcesFromMeta();
    this.updateDictionary();
    const metadata = await this.dictionaryService.getMetadata();

    if (this.dictionaryValidation(metadata)) {
      this.dictionaryService.setDictionaryStartHeight(
        metadata._metadata.startHeight,
      );
    }

    this.eventEmitter.emit(IndexerEvent.UsingDictionary, {
      value: Number(this.useDictionary),
    });
    await this.getFinalizedBlockHead();
    await this.getBestBlockHead();

    await this.blockDispatcher.init(this.resetForNewDs.bind(this));
    void this.startLoop(startHeight);
  }

  getUseDictionary(): boolean {
    return this.useDictionary;
  }

  getLatestFinalizedHeight(): number {
    return this.latestFinalizedHeight;
  }

  @Interval(CHECK_MEMORY_INTERVAL)
  checkBatchScale(): void {
    if (this.nodeConfig['scale-batch-size']) {
      const scale = checkMemoryUsage(this.batchSizeScale, this.nodeConfig);

      if (this.batchSizeScale !== scale) {
        this.batchSizeScale = scale;
      }
    }
  }

  async getFinalizedBlockHead(): Promise<void> {
    if (!this.api) {
      logger.debug(`Skip fetch finalized block until API is ready`);
      return;
    }
    try {
      const finalizedHeader = (await this.api.block({ finality: 'final' }))
        .header;
      this.unfinalizedBlocksService.registerFinalizedBlock(finalizedHeader);
      const currentFinalizedHeight = finalizedHeader.height;
      if (this.latestFinalizedHeight !== currentFinalizedHeight) {
        this.latestFinalizedHeight = currentFinalizedHeight;
        if (!this.nodeConfig.unfinalizedBlocks) {
          this.eventEmitter.emit(IndexerEvent.BlockTarget, {
            height: this.latestFinalizedHeight,
          });
        }
      }
    } catch (e) {
      logger.error(e, `Having a problem when getting finalized block`);
    }
  }

  async getBestBlockHead(): Promise<void> {
    if (!this.api) {
      logger.debug(`Skip fetch best block until API is ready`);
      return;
    }
    try {
      const bestHeader = (await this.api.block({ finality: 'optimistic' }))
        .header;
      const currentBestHeight = bestHeader.height;
      if (this.latestBestHeight !== currentBestHeight) {
        this.latestBestHeight = currentBestHeight;
        this.eventEmitter.emit(IndexerEvent.BlockBest, {
          height: this.latestBestHeight,
        });

        if (this.nodeConfig.unfinalizedBlocks) {
          this.eventEmitter.emit(IndexerEvent.BlockTarget, {
            height: this.latestBestHeight,
          });
        }
      }
    } catch (e) {
      logger.error(e, `Having a problem when get best block`);
    }
  }
  private async startLoop(initBlockHeight: number): Promise<void> {
    await this.fillNextBlockBuffer(initBlockHeight);
  }

  getModulos(): number[] {
    const modulos: number[] = [];
    for (const ds of this.project.dataSources) {
      if (isCustomDs(ds)) {
        continue;
      }
      for (const handler of ds.mapping.handlers) {
        if (
          handler.kind === NearHandlerKind.Block &&
          handler.filter &&
          handler.filter.modulo
        ) {
          modulos.push(handler.filter.modulo);
        }
      }
    }
    return modulos;
  }

  getModuloBlocks(startHeight: number, endHeight: number): number[] {
    const modulos = this.getModulos();
    const moduloBlocks: number[] = [];
    for (let i = startHeight; i < endHeight; i++) {
      if (modulos.find((m) => i % m === 0)) {
        moduloBlocks.push(i);
      }
    }
    return moduloBlocks;
  }

  getEnqueuedModuloBlocks(startBlockHeight: number): number[] {
    return this.getModuloBlocks(
      startBlockHeight,
      this.nodeConfig.batchSize * Math.max(...this.getModulos()) +
        startBlockHeight,
    ).slice(0, this.nodeConfig.batchSize);
  }

  async fillNextBlockBuffer(initBlockHeight: number): Promise<void> {
    let startBlockHeight: number;
    let scaledBatchSize: number;
    const handlers = [].concat(
      ...this.project.dataSources.map((ds) => ds.mapping.handlers),
    );

    const getStartBlockHeight = (): number => {
      return this.blockDispatcher.latestBufferedHeight
        ? this.blockDispatcher.latestBufferedHeight + 1
        : initBlockHeight;
    };

    if (this.dictionaryService.startHeight > getStartBlockHeight()) {
      logger.warn(
        `Dictionary start height ${
          this.dictionaryService.startHeight
        } is beyond indexing height ${getStartBlockHeight()}, skipping dictionary for now`,
      );
    }

    while (!this.isShutdown) {
      startBlockHeight = getStartBlockHeight();

      scaledBatchSize = Math.max(
        Math.round(this.batchSizeScale * this.nodeConfig.batchSize),
        Math.min(MINIMUM_BATCH_SIZE, this.nodeConfig.batchSize * 3),
      );
      const latestHeight = this.nodeConfig.unfinalizedBlocks
        ? this.latestBestHeight
        : this.latestFinalizedHeight;

      if (
        this.blockDispatcher.freeSize < scaledBatchSize ||
        startBlockHeight > latestHeight
      ) {
        await delay(1);
        continue;
      }

      if (
        this.useDictionary &&
        startBlockHeight >= this.dictionaryService.startHeight
      ) {
        const queryEndBlock = startBlockHeight + DICTIONARY_MAX_QUERY_SIZE;
        const moduloBlocks = this.getModuloBlocks(
          startBlockHeight,
          queryEndBlock,
        );

        try {
          const dictionary =
            await this.dictionaryService.scopedDictionaryEntries(
              startBlockHeight,
              queryEndBlock,
              scaledBatchSize,
            );

          if (startBlockHeight !== getStartBlockHeight()) {
            logger.debug(
              `Queue was reset for new DS, discarding dictionary query result`,
            );
            continue;
          }

          if (
            dictionary &&
            this.dictionaryValidation(dictionary, startBlockHeight)
          ) {
            let { batchBlocks } = dictionary;

            batchBlocks = batchBlocks
              .concat(moduloBlocks)
              .sort((a, b) => a - b);
            if (batchBlocks.length === 0) {
              // There we're no blocks in this query range, we can set a new height we're up to
              this.blockDispatcher.enqueueBlocks(
                [],
                Math.min(
                  queryEndBlock - 1,
                  dictionary._metadata.lastProcessedHeight,
                ),
              );
            } else {
              const maxBlockSize = Math.min(
                batchBlocks.length,
                this.blockDispatcher.freeSize,
              );
              const enqueuingBlocks = batchBlocks.slice(0, maxBlockSize);
              const cleanedBatchBlocks =
                this.filteredBlockBatch(enqueuingBlocks);

              this.blockDispatcher.enqueueBlocks(
                cleanedBatchBlocks,
                this.getLatestBufferHeight(cleanedBatchBlocks, enqueuingBlocks),
              );
            }
            continue; // skip nextBlockRange() way
          }
          // else use this.nextBlockRange()
        } catch (e) {
          logger.debug(`Fetch dictionary stopped: ${e.message}`);
          this.eventEmitter.emit(IndexerEvent.SkipDictionary);
        }
      }
      const endHeight = this.nextEndBlockHeight(
        startBlockHeight,
        scaledBatchSize,
      );

      if (handlers.length && this.getModulos().length === handlers.length) {
        const enqueuingBlocks = this.getEnqueuedModuloBlocks(startBlockHeight);
        const cleanedBatchBlocks = this.filteredBlockBatch(enqueuingBlocks);
        this.blockDispatcher.enqueueBlocks(
          cleanedBatchBlocks,
          this.getLatestBufferHeight(cleanedBatchBlocks, enqueuingBlocks),
        );
      } else {
        const enqueuingBlocks = range(startBlockHeight, endHeight + 1);
        const cleanedBatchBlocks = this.filteredBlockBatch(enqueuingBlocks);
        this.blockDispatcher.enqueueBlocks(
          cleanedBatchBlocks,
          this.getLatestBufferHeight(cleanedBatchBlocks, enqueuingBlocks),
        );
      }
    }
  }
  private getLatestBufferHeight(
    cleanedBatchBlocks: number[],
    rawBatchBlocks: number[],
  ): number {
    return Math.max(...cleanedBatchBlocks, ...rawBatchBlocks);
  }
  private filteredBlockBatch(currentBatchBlocks: number[]): number[] {
    if (!this.bypassBlocks.length || !currentBatchBlocks) {
      return currentBatchBlocks;
    }

    const cleanedBatch = cleanedBatchBlocks(
      this.bypassBlocks,
      currentBatchBlocks,
    );

    const pollutedBlocks = this.bypassBlocks.filter(
      (b) => b < Math.max(...currentBatchBlocks),
    );
    if (pollutedBlocks.length) {
      logger.info(`Bypassing blocks: ${pollutedBlocks}`);
    }
    this.bypassBlocks = without(this.bypassBlocks, ...pollutedBlocks);
    return cleanedBatch;
  }

  private nextEndBlockHeight(
    startBlockHeight: number,
    scaledBatchSize: number,
  ): number {
    let endBlockHeight = startBlockHeight + scaledBatchSize - 1;

    if (endBlockHeight > this.latestFinalizedHeight) {
      if (this.nodeConfig.unfinalizedBlocks) {
        if (endBlockHeight >= this.latestBestHeight) {
          endBlockHeight = this.latestBestHeight;
        }
      } else {
        endBlockHeight = this.latestFinalizedHeight;
      }
    }
    return endBlockHeight;
  }

  async resetForNewDs(blockHeight: number): Promise<void> {
    await this.syncDynamicDatascourcesFromMeta();
    this.dynamicDsService.deleteTempDsRecords(blockHeight);
    this.updateDictionary();
    this.blockDispatcher.flushQueue(blockHeight);
  }
  async resetForIncorrectBestBlock(blockHeight: number): Promise<void> {
    await this.syncDynamicDatascourcesFromMeta();
    this.updateDictionary();
    this.blockDispatcher.flushQueue(blockHeight);
  }

  private dictionaryValidation(
    dictionary: { _metadata: MetaData },
    startBlockHeight?: number,
  ): boolean {
    if (dictionary !== undefined) {
      const { _metadata: metaData } = dictionary;

      if (metaData.genesisHash !== this.apiService.genesisHash()) {
        logger.error(
          'The dictionary that you have specified does not match the chain you are indexing, it will be ignored. Please update your project manifest to reference the correct dictionary',
        );
        this.dictionaryGenesisMatches = false;
        this.eventEmitter.emit(IndexerEvent.UsingDictionary, {
          value: Number(this.useDictionary),
        });
        this.eventEmitter.emit(IndexerEvent.SkipDictionary);
        return false;
      }

      if (startBlockHeight !== undefined) {
        if (metaData.lastProcessedHeight < startBlockHeight) {
          logger.warn(
            `Dictionary indexed block is behind current indexing block height`,
          );
          this.eventEmitter.emit(IndexerEvent.SkipDictionary);
          return false;
        }
      }
      return true;
    }
    return false;
  }

  private getBaseHandlerKind(
    ds: NearDataSource,
    handler: NearHandler,
  ): NearHandlerKind {
    if (isRuntimeDs(ds) && isBaseHandler(handler)) {
      return handler.kind;
    } else if (isCustomDs(ds) && isCustomHandler(handler)) {
      const plugin = this.dsProcessorService.getDsProcessor(ds);
      const baseHandler =
        plugin.handlerProcessors[handler.kind]?.baseHandlerKind;
      if (!baseHandler) {
        throw new Error(
          `handler type ${handler.kind} not found in processor for ${ds.kind}`,
        );
      }
      return baseHandler;
    }
  }

  private getBaseHandlerFilters<T extends NearRuntimeHandlerFilter>(
    ds: NearDataSource,
    handlerKind: string,
  ): T[] {
    if (isCustomDs(ds)) {
      const plugin = this.dsProcessorService.getDsProcessor(ds);
      const processor = plugin.handlerProcessors[handlerKind];
      return processor.baseFilter instanceof Array
        ? (processor.baseFilter as T[])
        : ([processor.baseFilter] as T[]);
    } else {
      throw new Error(`expect custom datasource here`);
    }
  }
}
