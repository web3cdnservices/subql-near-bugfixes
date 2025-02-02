// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import {
  NodeConfig,
  DictionaryService as CoreDictionaryService,
} from '@subql/node-core';
import { MetaData } from '@subql/utils';
import { SubqueryProject } from '../configure/SubqueryProject';

export type SpecVersion = {
  id: string;
  start: number; //start with this block
  end: number;
};

export type SpecVersionDictionary = {
  _metadata: MetaData;
  specVersions: SpecVersion[];
};

@Injectable()
export class DictionaryService
  extends CoreDictionaryService
  implements OnApplicationShutdown
{
  constructor(
    @Inject('ISubqueryProject') protected project: SubqueryProject,
    nodeConfig: NodeConfig,
  ) {
    super(project.network.dictionary, project.network.chainId, nodeConfig, [
      'lastProcessedHeight',
      'genesisHash',
      'chain',
    ]);
  }
}
