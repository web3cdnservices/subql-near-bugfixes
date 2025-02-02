// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import fs from 'fs';
import path from 'path';
import { Inject, Injectable } from '@nestjs/common';
import {
  isCustomDs,
  NearCustomDataSource,
  NearDataSource,
  NearDatasourceProcessor,
  NearNetworkFilter,
} from '@subql/common-near';
import { BaseDsProcessorService } from '@subql/node-core';
import {
  SecondLayerHandlerProcessor_0_0_0,
  SecondLayerHandlerProcessor_1_0_0,
  NearCustomDatasource,
  NearHandlerKind,
} from '@subql/types-near';

export function isSecondLayerHandlerProcessor_0_0_0<
  K extends NearHandlerKind,
  F,
  E,
  DS extends NearCustomDatasource = NearCustomDatasource,
>(
  processor:
    | SecondLayerHandlerProcessor_0_0_0<K, F, E, DS>
    | SecondLayerHandlerProcessor_1_0_0<K, F, E, DS>,
): processor is SecondLayerHandlerProcessor_0_0_0<K, F, E, DS> {
  // Exisiting datasource processors had no concept of specVersion, therefore undefined is equivalent to 0.0.0
  return processor.specVersion === undefined;
}

export function isSecondLayerHandlerProcessor_1_0_0<
  K extends NearHandlerKind,
  F,
  E,
  DS extends NearCustomDatasource = NearCustomDatasource,
>(
  processor:
    | SecondLayerHandlerProcessor_0_0_0<K, F, E, DS>
    | SecondLayerHandlerProcessor_1_0_0<K, F, E, DS>,
): processor is SecondLayerHandlerProcessor_1_0_0<K, F, E, DS> {
  return processor.specVersion === '1.0.0';
}

export function asSecondLayerHandlerProcessor_1_0_0<
  K extends NearHandlerKind,
  F,
  E,
  DS extends NearCustomDatasource = NearCustomDatasource,
>(
  processor:
    | SecondLayerHandlerProcessor_0_0_0<K, F, E, DS>
    | SecondLayerHandlerProcessor_1_0_0<K, F, E, DS>,
): SecondLayerHandlerProcessor_1_0_0<K, F, E, DS> {
  if (isSecondLayerHandlerProcessor_1_0_0(processor)) {
    return processor;
  }

  if (!isSecondLayerHandlerProcessor_0_0_0(processor)) {
    throw new Error('Unsupported ds processor version');
  }

  return {
    ...processor,
    specVersion: '1.0.0',
    filterProcessor: (params) =>
      processor.filterProcessor(params.filter, params.input, params.ds),
    transformer: (params) =>
      processor
        .transformer(params.input, params.ds, params.api, params.assets)
        .then((res) => [res]),
  };
}

@Injectable()
export class DsProcessorService extends BaseDsProcessorService<
  NearDataSource,
  NearCustomDataSource<string, NearNetworkFilter>,
  NearDatasourceProcessor<string, NearNetworkFilter>
> {
  protected isCustomDs = isCustomDs;
}
