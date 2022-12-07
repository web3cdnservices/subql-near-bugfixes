// Copyright 2020-2022 OnFinality Limited authors & contributors
// SPDX-License-Identifier: Apache-2.0

import {RegisteredTypes} from '@polkadot/types/types';
import {BaseMapping, IProjectManifest} from '@subql/common';
import {
  NearRuntimeDatasource,
  NearNetworkFilter,
  NearRuntimeHandlerFilter,
  NearRuntimeHandler,
  NearDatasourceKind,
} from '@subql/types';
import {NearProjectNetworkConfig} from '../../types';

export type ProjectNetworkConfigV0_0_1 = NearProjectNetworkConfig & RegisteredTypes;

// export interface RuntimeDataSourceV0_0_1 extends NearRuntimeDataSource {
//   name: string;
//   filter?: NearNetworkFilter;
// }

export type ManifestV0_0_1Mapping = Omit<BaseMapping<NearRuntimeHandlerFilter, NearRuntimeHandler>, 'file'>;

export interface RuntimeDataSourceV0_0_1 extends Omit<NearRuntimeDatasource, 'mapping'> {
  name: string;
  filter?: NearNetworkFilter;
  kind: NearDatasourceKind.Runtime;
  mapping: ManifestV0_0_1Mapping;
}

export interface ProjectManifestV0_0_1 extends IProjectManifest<RuntimeDataSourceV0_0_1> {
  schema: string;
  network: ProjectNetworkConfigV0_0_1;
}
