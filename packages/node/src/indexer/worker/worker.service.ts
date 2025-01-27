// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import { threadId } from 'node:worker_threads';
import { Inject, Injectable } from '@nestjs/common';
import {
  NodeConfig,
  getLogger,
  AutoQueue,
  memoryLock,
  IProjectService,
  ProcessBlockResponse,
} from '@subql/node-core';
import { NearDatasource } from '@subql/types-near';
import { SubqlProjectDs } from '../../configure/SubqueryProject';
import { ApiService } from '../api.service';
import { SpecVersion } from '../dictionary.service';
import { IndexerManager } from '../indexer.manager';
import { BlockContent } from '../types';

export type FetchBlockResponse =
  | { specVersion: number; parentHash: string }
  | undefined;

export type WorkerStatusResponse = {
  threadId: number;
  isIndexing: boolean;
  fetchedBlocks: number;
  toFetchBlocks: number;
};

const logger = getLogger(`Worker Service #${threadId}`);

class BlockUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockUnavailableError';
  }
}

@Injectable()
export class WorkerService {
  private fetchedBlocks: Record<string, BlockContent> = {};
  private _isIndexing = false;

  private queue: AutoQueue<FetchBlockResponse>;

  constructor(
    private apiService: ApiService,
    private indexerManager: IndexerManager,
    @Inject('IProjectService')
    private projectService: IProjectService<NearDatasource>,
    nodeConfig: NodeConfig,
  ) {
    this.queue = new AutoQueue(undefined, nodeConfig.batchSize);
  }

  async fetchBlock(height: number): Promise<FetchBlockResponse> {
    try {
      return await this.queue.put(async () => {
        // If a dynamic ds is created we might be asked to fetch blocks again, use existing result
        if (!this.fetchedBlocks[height]) {
          if (memoryLock.isLocked()) {
            const start = Date.now();
            await memoryLock.waitForUnlock();
            const end = Date.now();
            logger.debug(`memory lock wait time: ${end - start}ms`);
          }

          const [block] = await this.apiService.fetchBlocks([height]);
          this.fetchedBlocks[height] = block;
        }

        const block = this.fetchedBlocks[height];
        // Return info to get the runtime version, this lets the worker thread know
        return undefined;
      });
    } catch (e) {
      logger.error(e, `Failed to fetch block ${height}`);
    }
  }

  async processBlock(height: number): Promise<ProcessBlockResponse> {
    try {
      this._isIndexing = true;
      const block = this.fetchedBlocks[height];

      if (block === null) {
        throw new BlockUnavailableError(
          `Block ${height} is unavailable in the chain`,
        );
      }

      if (!block) {
        throw new Error(`Block ${height} has not been fetched`);
      }

      delete this.fetchedBlocks[height];

      return await this.indexerManager.indexBlock(
        block,
        await this.projectService.getAllDataSources(height),
      );
    } catch (e) {
      if (e instanceof BlockUnavailableError) {
        logger.warn(e.message);
        return {
          blockHash: null,
          dynamicDsCreated: false,
          reindexBlockHeight: null,
        };
      } else {
        logger.error(e, `Failed to index block ${height}: ${e.stack}`);
        throw e;
      }
    } finally {
      this._isIndexing = false;
    }
  }

  get numFetchedBlocks(): number {
    return Object.keys(this.fetchedBlocks).length;
  }

  get numFetchingBlocks(): number {
    return this.queue.size;
  }

  get isIndexing(): boolean {
    return this._isIndexing;
  }
}
