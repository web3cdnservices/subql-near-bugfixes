# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.10.0] - 2023-08-02
### Changed
- Sync with main sdk (#56)

## [2.8.0] - 2023-06-27
### Changed
- Sync with main sdk and update deps (#51)

### Fixed
- Dictionary validation failing with chainId (#51)

## [2.6.1] - 2023-06-16
### Fixed
- Fixed an issue where MetaService caught NodeConfig undefined

## [2.6.0] - 2023-06-16
### Added
- Multiple-endpoint improvements from latest node-core (#44)

### Fixed
- Fix module missing sequelize, use subql/x-sequelize (#44)

## [2.5.2] - 2023-06-15
### Fixed
- Fixed workers to handle unavailable blocks without throwing errors (#46)

## [2.5.1] - 2023-06-08
### Fixed
- Sync with node-core 2.4.4, fixed various issue for mmr

## [2.5.0] - 2023-06-02
### Fixed
- Updated dependencies with fixes and ported over relevant fixes from main sdk (#41)

## [2.3.1] - 2023-05-25
### Changed
- Updated node-core to fix issue with base58 block hashes and POI

## [2.3.0] - 2023-05-23
### Changed
- Update to Node 18
- Updated `@subql/node-core`

## 2.1.1 - 2023-05-17
### Fixed
- Previous release

## 2.1.0 - 2023-05-17
### Added
- Support for unfinalized blocks with workers

### Changed
- Sync with main SDK

## 2.0.0 - 2023-05-01
### Added
- Added Database cache feature, this significantly improve indexing performance
  - Data flush to database when number of records reaches `--store-cache-threshold` value (default is 1000), this reduces number of transactions to database in order to save time.
  - Direct get data from the cache rather than wait to retrieve it from database, with flag `--store-get-cache-size` user could decide how many records for **each** entity they want to keep in the cache (default is 500)
  - If enabled `--store-cache-async` writing data to the store is asynchronous with regard to block processing (default is enabled)
- Testing Framework, allow users to test their projects filters and handler functions without having to index the project
  - Create test files with the naming convention `*.test.ts` and place them in the `src/tests` or `src/test` folder. Each test file should contain test cases for specific mapping handlers.
  - Run the testing service using the command: `subql-node-near test`.

## 1.21.1 - 2023-03-30
### Fixed
- Pin @subql/node-core  version to 1.10.1-2

## 1.21.0 - 2023-03-28
### Changed
- Sync latest changes from main SDK

## 1.20.1 - 2023-03-15
### Added
- Index ids of receipt created by a transaction

## 1.20.0 - 2023-03-13
### Changed
- Sync latest changes from @subql/node (#22)

## 1.19.3 - 2023-03-06
### Added
- Sync latest changes from @subql/node

## 1.19.2 - 2023-03-06
### Added
- Sync latest changes from @subql/node

## 1.19.1 - 2023-03-03
### Added
- Sync latest changes from @subql/node

### Fixed
- Update sequelize version to match with other @subql modules

## 1.19.0 - 2023-03-02
### Added
- Add transaction receipt handlers and filters (#13)

## 1.18.1 - 2023-02-03
### Changed
- Add `toJson` method to function args (#9)

## 1.18.0 - 2023-01-26
[Unreleased]: https://github.com/subquery/subql-near/compare/node-near/2.10.0...HEAD
[2.10.0]: https://github.com/subquery/subql-near/compare/node-near/2.8.0...node-near/2.10.0
[2.8.0]: https://github.com/subquery/subql-near/compare/node-near/2.6.1...node-near/2.8.0
[2.6.1]: https://github.com/subquery/subql-near/compare/node-near/2.6.0...node-near/2.6.1
[2.6.0]: https://github.com/subquery/subql-near/compare/node-near/2.5.2...node-near/2.6.0
[2.5.2]: https://github.com/subquery/subql-near/compare/node-near/2.5.1...node-near/2.5.2
[2.5.1]: https://github.com/subquery/subql-near/compare/node-near/2.5.0...node-near/2.5.1
[2.5.0]: https://github.com/subquery/subql-near/compare/node-near/2.3.1...node-near/2.5.0
[2.3.1]: https://github.com/subquery/subql-near/compare/node-near/2.3.0...node-near/2.3.1
[2.3.0]: https://github.com/subquery/subql-near/compare/node-near/2.1.1...node-near/2.3.0
