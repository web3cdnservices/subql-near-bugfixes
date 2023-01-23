// Copyright 2020-2022 OnFinality Limited authors & contributors
// SPDX-License-Identifier: Apache-2.0

import {ProjectManifestBaseImpl} from '@subql/common';
import {NearDatasourceKind, NearHandlerKind, NearNetworkFilter, NearRuntimeHandler} from '@subql/types-near';
import {plainToClass, Transform, Type} from 'class-transformer';
import {
  Equals,
  IsArray,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
  validateSync,
} from 'class-validator';
import {SubqlNetworkFilterImpl, ActionHandler, TransactionHandler, BlockHandler} from '../../models';
import {NearProjectNetworkConfig} from '../../types';
import {ManifestV0_0_1Mapping, ProjectManifestV0_0_1, RuntimeDataSourceV0_0_1} from './types';

export class ProjectNetworkV0_0_1 implements NearProjectNetworkConfig {
  @IsString()
  endpoint: string;
  @IsString()
  @IsOptional()
  dictionary?: string;
}

export class RuntimeMappingV0_0_1 implements ManifestV0_0_1Mapping {
  @Transform((params) => {
    const handlers: NearRuntimeHandler[] = params.value;
    return handlers.map((handler) => {
      switch (handler.kind) {
        case NearHandlerKind.Action:
          return plainToClass(ActionHandler, handler);
        case NearHandlerKind.Transaction:
          return plainToClass(TransactionHandler, handler);
        case NearHandlerKind.Block:
          return plainToClass(BlockHandler, handler);
        default:
          throw new Error(`handler ${(handler as any).kind} not supported`);
      }
    });
  })
  @IsArray()
  @ValidateNested()
  handlers: NearRuntimeHandler[];
}

export class RuntimeDataSourceV0_0_1Impl implements RuntimeDataSourceV0_0_1 {
  @IsString()
  name: string;
  @IsEnum(NearDatasourceKind, {groups: [NearDatasourceKind.Runtime]})
  kind: NearDatasourceKind.Runtime;
  @Type(() => RuntimeMappingV0_0_1)
  @ValidateNested()
  mapping: RuntimeMappingV0_0_1;
  @IsOptional()
  @IsInt()
  startBlock?: number;
  @IsOptional()
  @ValidateNested()
  @Type(() => SubqlNetworkFilterImpl)
  filter?: NearNetworkFilter;
}

export class ProjectManifestV0_0_1Impl extends ProjectManifestBaseImpl<null> implements ProjectManifestV0_0_1 {
  @Equals('0.0.1')
  specVersion: string;
  @ValidateNested()
  @Type(() => ProjectNetworkV0_0_1)
  @IsObject()
  network: ProjectNetworkV0_0_1;
  @IsString()
  schema: string;
  @IsArray()
  @ValidateNested()
  @Type(() => RuntimeDataSourceV0_0_1Impl)
  dataSources: RuntimeDataSourceV0_0_1[];

  get deployment(): null {
    throw new Error('Manifest spec 0.0.1 is not support for deployment, please migrate to 0.2.0 or above');
  }

  validate(): void {
    const errors = validateSync(this, {whitelist: true, forbidNonWhitelisted: true});
    if (errors?.length) {
      // TODO: print error details
      const errorMsgs = errors.map((e) => e.toString()).join('\n');
      throw new Error(`failed to parse project.yaml.\n${errorMsgs}`);
    }
  }
}
