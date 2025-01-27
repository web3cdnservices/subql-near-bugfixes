// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  IndexerEvent,
  NetworkMetadataPayload,
  getLogger,
  NodeConfig,
  profilerWrap,
  ConnectionPoolService,
  ApiService as BaseApiService,
} from '@subql/node-core';
import * as Near from 'near-api-js';
import {
  AccessKeyWithPublicKey,
  BlockChangeResult,
  BlockReference,
  BlockResult,
  ChangeResult,
  EpochValidatorInfo,
  GasPrice,
} from 'near-api-js/lib/providers/provider';
import { ConnectionInfo } from 'near-api-js/lib/utils/web';

import { SubqueryProject } from '../configure/SubqueryProject';
import * as NearUtil from '../utils/near';
import { NearApiConnection } from './nearApi.connection';
import { BlockContent } from './types';

const GENESIS_BLOCK = 9_820_210;
const MAX_RECONNECT_ATTEMPTS = 5;

const logger = getLogger('api');

@Injectable()
export class ApiService extends BaseApiService<
  Near.providers.JsonRpcProvider,
  SafeJsonRpcProvider,
  BlockContent
> {
  private fetchBlocksBatches = NearUtil.fetchBlocksBatches;
  networkMeta: NetworkMetadataPayload;

  constructor(
    @Inject('ISubqueryProject') private project: SubqueryProject,
    connectionPoolService: ConnectionPoolService<NearApiConnection>,
    private eventEmitter: EventEmitter2,
    private nodeConfig: NodeConfig,
  ) {
    super(connectionPoolService);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.connectionPoolService.onApplicationShutdown();
  }

  private metadataMismatchError(
    metadata: string,
    expected: string,
    actual: string,
  ): Error {
    return Error(
      `Value of ${metadata} does not match across all endpoints\n
       Expected: ${expected}
       Actual: ${actual}`,
    );
  }

  async init(): Promise<ApiService> {
    let network;
    try {
      network = this.project.network;
    } catch (e) {
      logger.error(e);
      process.exit(1);
    }

    if (this.nodeConfig?.profiler) {
      this.fetchBlocksBatches = profilerWrap(
        NearUtil.fetchBlocksBatches,
        'NearUtil',
        'fetchBlocksBatches',
      );
    }

    const endpointToApiIndex: Record<string, NearApiConnection> = {};

    for await (const [i, endpoint] of network.endpoint.entries()) {
      const connection = await NearApiConnection.create(
        endpoint,
        this.fetchBlocksBatches,
      );
      const api = connection.unsafeApi;

      this.eventEmitter.emit(IndexerEvent.ApiConnected, {
        value: 1,
        apiIndex: i,
        endpoint: endpoint,
      });

      const chainId = (await api.status()).chain_id;

      if (!this.networkMeta) {
        this.networkMeta = connection.networkMeta;

        if (network.chainId && network.chainId !== this.networkMeta.chain) {
          const err = new Error(
            `Network chainId doesn't match expected genesisHash. Your SubQuery project is expecting to index data from "${
              network.chainId ?? network.genesisHash
            }", however the endpoint that you are connecting to is different("${
              this.networkMeta.chain
            }). Please check that the RPC endpoint is actually for your desired network or update the genesisHash.`,
          );
          logger.error(err, err.message);
          throw err;
        }
      } else {
        const genesisHash = (await api.block({ blockId: GENESIS_BLOCK })).header
          .hash;
        if (this.networkMeta.genesisHash !== genesisHash) {
          throw this.metadataMismatchError(
            'Genesis Hash',
            this.networkMeta.genesisHash,
            genesisHash,
          );
        }
      }

      endpointToApiIndex[endpoint] = connection;
    }

    this.connectionPoolService.addBatchToConnections(endpointToApiIndex);
    return this;
  }

  get api(): Near.providers.JsonRpcProvider {
    return this.unsafeApi;
  }

  safeApi(height: number): SafeJsonRpcProvider {
    return new SafeJsonRpcProvider(height, this.api.connection);
  }

  genesisHash(): string {
    return this.networkMeta.genesisHash;
  }
}

export class SafeJsonRpcProvider extends Near.providers.JsonRpcProvider {
  constructor(private height: number, private connectionInfo: ConnectionInfo) {
    super(connectionInfo);
  }

  async block(): Promise<BlockResult> {
    return super.block({ blockId: this.height });
  }

  async blockChanges(): Promise<BlockChangeResult> {
    return super.blockChanges({ blockId: this.height });
  }

  async validators(): Promise<EpochValidatorInfo> {
    return super.validators(this.height);
  }

  async accessKeyChanges(accountIdArray: string[]): Promise<ChangeResult> {
    return super.accessKeyChanges(accountIdArray, { blockId: this.height });
  }

  async singleAccessKeyChanges(
    accessKeyArray: AccessKeyWithPublicKey[],
  ): Promise<ChangeResult> {
    return super.singleAccessKeyChanges(accessKeyArray, {
      blockId: this.height,
    });
  }

  async accountChanges(accountIdArray: string[]): Promise<ChangeResult> {
    return super.accountChanges(accountIdArray, { blockId: this.height });
  }

  async contractStateChanges(
    accountIdArray: string[],
    blockQuery: BlockReference = { blockId: this.height },
    keyPrefix?: string,
  ): Promise<ChangeResult> {
    return super.contractStateChanges(
      accountIdArray,
      { blockId: this.height },
      keyPrefix,
    );
  }

  async contractCodeChanges(accountIdArray: string[]): Promise<ChangeResult> {
    return super.contractCodeChanges(accountIdArray, { blockId: this.height });
  }

  async gasPrice(): Promise<GasPrice> {
    return super.gasPrice(this.height);
  }
}
