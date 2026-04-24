// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

contract MockSequencerUptimeFeed {
  int256 private _answer;
  uint256 private _startedAt;
  uint80 private _roundId;

  constructor(int256 initialAnswer, uint256 initialStartedAt) public {
    _answer = initialAnswer;
    _startedAt = initialStartedAt;
    _roundId = 1;
  }

  function setLatestRoundData(int256 answer, uint256 startedAt) external {
    _answer = answer;
    _startedAt = startedAt;
    _roundId++;
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
