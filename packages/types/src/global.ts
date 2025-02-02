// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {providers} from 'near-api-js';
import Pino from 'pino';
import {Store, DynamicDatasourceCreator} from './interfaces';

declare global {
  const api: providers.JsonRpcProvider;
  const logger: Pino.Logger;
  const store: Store;
  const chainId: string;
  const createDynamicDatasource: DynamicDatasourceCreator;
}
