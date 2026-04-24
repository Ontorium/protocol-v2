// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import {IChainlinkAggregator} from '../interfaces/IChainlinkAggregator.sol';

/// @notice Wraps an ounce-denominated Chainlink-style feed and exposes a gram-denominated price.
/// @dev GRAMS_PER_OUNCE is scaled by 1e8 so wrapped feed keeps the source decimals unchanged.
contract OXAUPerGramFeed is IChainlinkAggregator {
  uint256 public constant GRAMS_PER_OUNCE = 3110347680;

  IChainlinkAggregator public immutable ozFeed;

  constructor(address _ozFeed) public {
    require(_ozFeed != address(0), 'INVALID_OZ_FEED');
    ozFeed = IChainlinkAggregator(_ozFeed);
  }

  function decimals() external view override returns (uint8) {
    return ozFeed.decimals();
  }

  function latestAnswer() external view override returns (int256) {
    int256 answer = ozFeed.latestAnswer();
    if (answer <= 0) {
      return answer;
    }

    return (answer * int256(1e8)) / int256(GRAMS_PER_OUNCE);
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
    (roundId, answer, startedAt, updatedAt, answeredInRound) = ozFeed.latestRoundData();

    if (answer > 0) {
      answer = (answer * int256(1e8)) / int256(GRAMS_PER_OUNCE);
    }
  }

  function latestTimestamp() external view override returns (uint256) {
    return ozFeed.latestTimestamp();
  }

  function latestRound() external view override returns (uint256) {
    return ozFeed.latestRound();
  }

  function getAnswer(uint256 roundId) external view override returns (int256) {
    int256 answer = ozFeed.getAnswer(roundId);
    if (answer <= 0) {
      return answer;
    }

    return (answer * int256(1e8)) / int256(GRAMS_PER_OUNCE);
  }

  function getTimestamp(uint256 roundId) external view override returns (uint256) {
    return ozFeed.getTimestamp(roundId);
  }
}
