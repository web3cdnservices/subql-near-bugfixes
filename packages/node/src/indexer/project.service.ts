// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  PoiService,
  MmrService,
  BaseProjectService,
  StoreService,
  NodeConfig,
  MmrQueryService,
} from '@subql/node-core';
import { Sequelize } from '@subql/x-sequelize';
import {
  generateTimestampReferenceForBlockFilters,
  SubqlProjectDs,
  SubqueryProject,
} from '../configure/SubqueryProject';
import { ApiService } from './api.service';
import { DsProcessorService } from './ds-processor.service';
import { DynamicDsService } from './dynamic-ds.service';
import { UnfinalizedBlocksService } from './unfinalizedBlocks.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: packageVersion } = require('../../package.json');

@Injectable()
export class ProjectService extends BaseProjectService<
  ApiService,
  SubqlProjectDs
> {
  protected packageVersion = packageVersion;

  constructor(
    dsProcessorService: DsProcessorService,
    apiService: ApiService,
    poiService: PoiService,
    mmrService: MmrService,
    mmrQueryService: MmrQueryService,
    sequelize: Sequelize,
    @Inject('ISubqueryProject') project: SubqueryProject,
    storeService: StoreService,
    nodeConfig: NodeConfig,
    dynamicDsService: DynamicDsService,
    eventEmitter: EventEmitter2,
    unfinalizedBlockService: UnfinalizedBlocksService,
  ) {
    super(
      dsProcessorService,
      apiService,
      poiService,
      mmrService,
      mmrQueryService,
      sequelize,
      project,
      storeService,
      nodeConfig,
      dynamicDsService,
      eventEmitter,
      unfinalizedBlockService,
    );
  }

  protected async generateTimestampReferenceForBlockFilters(
    ds: SubqlProjectDs[],
  ): Promise<SubqlProjectDs[]> {
    return generateTimestampReferenceForBlockFilters(ds, this.apiService.api);
  }

  protected getStartBlockDatasources(): SubqlProjectDs[] {
    return this.project.dataSources;
  }

  async getAllDataSources(blockHeight: number): Promise<SubqlProjectDs[]> {
    const dynamicDs = await this.dynamicDsService.getDynamicDatasources();

    return [...this.project.dataSources, ...dynamicDs].filter(
      (ds) => ds.startBlock <= blockHeight,
    );
  }
}
