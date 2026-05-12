// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import {ISequencerFeed} from '../../../interfaces/ISequencerFeed.sol';

/// @notice Test-only sequencer feed.
/// @dev    Plug into the production `PriceOracleSentinel` as its `_sequencerFeed`.
///         On mainnet, replace this with the live ChainLink L2 sequencer feed via
///         `PriceOracleSentinel.setSequencerFeed(...)` — the sentinel itself stays.
///
///         `setLatestRoundData` has NO access control by design: tests / operators
///         flip sequencer state directly. Do not deploy in production.
contract MockSequencerUptimeFeed is ISequencerFeed {
  int256 private _answer;
  uint256 private _startedAt;
  uint80 private _roundId;

  event LatestRoundDataSet(int256 answer, uint256 startedAt, uint80 roundId);

  constructor(int256 initialAnswer, uint256 initialStartedAt) public {
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
    override
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
