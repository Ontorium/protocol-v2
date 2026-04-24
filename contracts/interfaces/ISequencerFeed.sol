// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

interface ISequencerFeed {
  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );
}
