// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import {SafeMath} from '../dependencies/openzeppelin/contracts/SafeMath.sol';
import {ILendingPoolAddressesProvider} from '../interfaces/ILendingPoolAddressesProvider.sol';
import {IPriceOracleSentinel} from '../interfaces/IPriceOracleSentinel.sol';
import {ISequencerFeed} from '../interfaces/ISequencerFeed.sol';
import {Errors} from '../protocol/libraries/helpers/Errors.sol';

/// @notice L2 sequencer-aware gate for borrow and liquidation flows.
/// @dev Unlike Aave V3's sentinel, this variant is shaped for the V2-style addresses provider
/// and pool-admin managed configuration.
contract PriceOracleSentinel is IPriceOracleSentinel {
  using SafeMath for uint256;

  ILendingPoolAddressesProvider public immutable ADDRESSES_PROVIDER;
  ISequencerFeed private _sequencerFeed;
  uint256 private _stabilizationWindow;

  event SequencerFeedChanged(address indexed feed);
  event StabilizationWindowChanged(uint256 delaySeconds);

  modifier onlyPoolAdmin() {
    require(msg.sender == ADDRESSES_PROVIDER.getPoolAdmin(), Errors.CALLER_NOT_POOL_ADMIN);
    _;
  }

  constructor(
    ILendingPoolAddressesProvider provider,
    address sequencerFeed,
    uint256 stabilizationWindow
  ) public {
    ADDRESSES_PROVIDER = provider;
    _sequencerFeed = ISequencerFeed(sequencerFeed);
    _stabilizationWindow = stabilizationWindow;
  }

  function isBorrowAllowed() external view override returns (bool) {
    return _isSequencerHealthy();
  }

  function isLiquidationAllowed() external view override returns (bool) {
    return _isSequencerHealthy();
  }

  function setSequencerFeed(address feed) external onlyPoolAdmin {
    _sequencerFeed = ISequencerFeed(feed);
    emit SequencerFeedChanged(feed);
  }

  function setStabilizationWindow(uint256 delaySeconds) external onlyPoolAdmin {
    _stabilizationWindow = delaySeconds;
    emit StabilizationWindowChanged(delaySeconds);
  }

  function getSequencerFeed() external view returns (address) {
    return address(_sequencerFeed);
  }

  function getStabilizationWindow() external view returns (uint256) {
    return _stabilizationWindow;
  }

  function _isSequencerHealthy() internal view returns (bool) {
    if (address(_sequencerFeed) == address(0)) {
      return true;
    }

    (, int256 answer, uint256 startedAt, , ) = _sequencerFeed.latestRoundData();
    if (answer != 0 || startedAt == 0) {
      return false;
    }

    return block.timestamp.sub(startedAt) > _stabilizationWindow;
  }
}
