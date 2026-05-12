// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

contract MockAggregator {
  int256 private _latestAnswer;
  uint8 private _decimals;
  uint256 private _updatedAt;
  uint256 private _startedAt;
  uint80 private _roundId;
  uint80 private _answeredInRound;

  event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 timestamp);

  constructor(int256 _initialAnswer, uint8 _initialDecimals) public {
    _latestAnswer = _initialAnswer;
    _decimals = _initialDecimals;
    _updatedAt = now;
    _startedAt = now;
    _roundId = 1;
    _answeredInRound = 1;
    emit AnswerUpdated(_initialAnswer, _roundId, now);
  }

  // ────────── setters (unrestricted — testnet/mock only) ──────────

  /// @notice Replace the price; advances roundId and stamps updatedAt = now.
  function setAnswer(int256 answer) external {
    _latestAnswer = answer;
    _roundId += 1;
    _answeredInRound = _roundId;
    _updatedAt = now;
    _startedAt = now;
    emit AnswerUpdated(answer, _roundId, now);
  }

  /// @notice Override updatedAt freely. Set to a past timestamp to make the
  ///         feed appear stale for AaveOracle's stale-time check.
  function setUpdatedAt(uint256 updatedAt) external {
    _updatedAt = updatedAt;
  }

  /// @notice Override every field returned by latestRoundData. Use for full
  ///         control in tests (e.g. updatedAt=0, future updatedAt, etc.).
  function setLatestRoundData(
    uint80 roundId,
    int256 answer,
    uint256 startedAt,
    uint256 updatedAt,
    uint80 answeredInRound
  ) external {
    _roundId = roundId;
    _latestAnswer = answer;
    _startedAt = startedAt;
    _updatedAt = updatedAt;
    _answeredInRound = answeredInRound;
    emit AnswerUpdated(answer, roundId, updatedAt);
  }

  // ────────── view interface ──────────

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
    return (_roundId, _latestAnswer, _startedAt, _updatedAt, _answeredInRound);
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
