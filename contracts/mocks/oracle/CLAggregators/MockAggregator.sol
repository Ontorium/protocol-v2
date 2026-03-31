// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

contract MockAggregator {
  int256 private _latestAnswer;
  uint8 private _decimals;

  event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 timestamp);

  constructor(int256 _initialAnswer, uint8 _initialDecimals) public {
    _latestAnswer = _initialAnswer;
    _decimals = _initialDecimals;
    emit AnswerUpdated(_initialAnswer, 0, now);
  }

  function latestAnswer() external view returns (int256) {
    return _latestAnswer;
  }

  function decimals() external view returns (uint8) {
    return _decimals;
  }

  function getTokenType() external view returns (uint256) {
    return 1;
  }
}
