// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import {ILendingPool} from '../../interfaces/ILendingPool.sol';

contract ReentrantLiquidationManager {
  function liquidationCall(
    address collateralAsset,
    address debtAsset,
    address user,
    uint256 debtToCover,
    bool receiveAToken
  ) external returns (uint256, string memory) {
    try
      ILendingPool(address(this)).liquidationCall(
        collateralAsset,
        debtAsset,
        user,
        debtToCover,
        receiveAToken
      )
    {
      return (0, '');
    } catch Error(string memory reason) {
      return (1, reason);
    } catch {
      return (1, 'UNKNOWN');
    }
  }
}
