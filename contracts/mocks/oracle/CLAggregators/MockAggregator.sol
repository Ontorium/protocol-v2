// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

contract MockAggregator {
  int256 private _latestAnswer;
  uint8 private _decimals;
  uint256 private _updatedAt;
  uint256 private _roundId;

  event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 timestamp);

  constructor(int256 _initialAnswer, uint8 _initialDecimals) public {
    _latestAnswer = _initialAnswer;
    _decimals = _initialDecimals;
    _updatedAt = now;
    _roundId = 1;
    emit AnswerUpdated(_initialAnswer, _roundId, now);
  }

  function latestAnswer() external view returns (int256) {
    return _latestAnswer;
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
    return (uint80(_roundId), _latestAnswer, _updatedAt, _updatedAt, uint80(_roundId));
  }

  function decimals() external view returns (uint8) {
    return _decimals;
  }

  function latestTimestamp() external view returns (uint256) {
    return _updatedAt;
  }

  function latestRound() external view returns (uint256) {
    return _roundId;
  }

  function getAnswer(uint256 roundId) external view returns (int256) {
    return roundId == _roundId ? _latestAnswer : 0;
  }

  function getTimestamp(uint256 roundId) external view returns (uint256) {
    return roundId == _roundId ? _updatedAt : 0;
  }

  function getTokenType() external view returns (uint256) {
    return 1;
  }
}
