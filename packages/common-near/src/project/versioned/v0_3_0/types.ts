// Copyright 2020-2022 OnFinality Limited authors & contributors
// SPDX-License-Identifier: Apache-2.0

import {
  // ISubqlProjectManifest as INearProjectManifest,
  NearDatasource,
  NearDatasourceKind,
} from '@subql/types';
import {INearProjectManifest} from '../../types';
import {RuntimeDataSourceV0_2_0, CustomDatasourceV0_2_0} from '../v0_2_0/types';

export interface NearProjectManifestV0_3_0 extends INearProjectManifest {
  name: string;
  version: string;
  schema: {
    file: string;
  };

  network: {
    genesisHash: string;
    endpoint?: string;
    dictionary?: string;
    chaintypes?: {
      file: string;
    };
  };

  dataSources: (RuntimeDataSourceV0_2_0 | CustomDatasourceV0_2_0)[];
}

export function isRuntimeDataSourceV0_3_0(dataSource: NearDatasource): dataSource is RuntimeDataSourceV0_2_0 {
  return dataSource.kind === NearDatasourceKind.Runtime && !!dataSource.mapping.file;
}
