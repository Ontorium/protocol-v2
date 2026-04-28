// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import {ILendingPoolAddressesProvider} from '../../../interfaces/ILendingPoolAddressesProvider.sol';
import {PriceOracleSentinel} from '../../../misc/PriceOracleSentinel.sol';

/// @notice Test-only sentinel that doubles as its own Chainlink-style sequencer feed.
/// @dev    Inherits the production sentinel and points its sequencer-feed slot at
///         `address(this)`, so the parent's `_isSequencerHealthy()` reads the
///         answer/startedAt that this contract exposes via `latestRoundData()`.
///         `setLatestRoundData` has NO access control by design — tests / operators
///         flip sequencer state directly. Do not use in production.
contract MockSequencerUptimeFeed is PriceOracleSentinel {
  int256 private _answer;
  uint256 private _startedAt;
  uint80 private _roundId;

  event LatestRoundDataSet(int256 answer, uint256 startedAt, uint80 roundId);

  constructor(
    ILendingPoolAddressesProvider provider,
    int256 initialAnswer,
    uint256 initialStartedAt,
    uint256 stabilizationWindow
  ) public PriceOracleSentinel(provider, address(this), stabilizationWindow) {
    _answer = initialAnswer;
    _startedAt = initialStartedAt;
    _roundId = 1;
  }

  function setLatestRoundData(int256 answer, uint256 startedAt) external {
    _answer = answer;
    _startedAt = startedAt;
    _roundId++;
    emit LatestRoundDataSet(answer, startedAt, _roundId);
  }

  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    )
  {
    return (_roundId, _answer, _startedAt, _startedAt, _roundId);
  }
}
