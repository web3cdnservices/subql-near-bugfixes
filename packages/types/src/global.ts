// Copyright 2020-2022 OnFinality Limited authors & contributors
// SPDX-License-Identifier: Apache-2.0

import {providers} from 'near-api-js';
import Pino from 'pino';
import {Store, DynamicDatasourceCreator} from './interfaces';

declare global {
  const api: providers.JsonRpcProvider;
  const logger: Pino.Logger;
  const store: Store;
  const createDynamicDatasource: DynamicDatasourceCreator;
}
