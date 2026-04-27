// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

import {SafeMath} from '../../dependencies/openzeppelin/contracts/SafeMath.sol';
import {IERC20} from '../../dependencies/openzeppelin/contracts/IERC20.sol';
import {SafeERC20} from '../../dependencies/openzeppelin/contracts/SafeERC20.sol';
import {FlashLoanReceiverBase} from '../../flashloan/base/FlashLoanReceiverBase.sol';
import {ILendingPoolAddressesProvider} from '../../interfaces/ILendingPoolAddressesProvider.sol';

/// @notice Flash-loan receiver that pays back with its own pre-funded balance
/// (no mint). Useful when the underlying ERC20 does not expose a permissionless mint.
contract SimpleFlashLoanReceiver is FlashLoanReceiverBase {
  using SafeMath for uint256;
  using SafeERC20 for IERC20;

  event Executed(address[] assets, uint256[] amounts, uint256[] premiums);

  constructor(ILendingPoolAddressesProvider provider) public FlashLoanReceiverBase(provider) {}

  function executeOperation(
    address[] memory assets,
    uint256[] memory amounts,
    uint256[] memory premiums,
    address /* initiator */,
    bytes memory /* params */
  ) public override returns (bool) {
    for (uint256 i = 0; i < assets.length; i++) {
      uint256 owed = amounts[i].add(premiums[i]);
      // Receiver must already hold `owed` (flash-loaned amount is already here;
      // premium must be pre-funded by caller before flashLoan).
      IERC20(assets[i]).approve(address(LENDING_POOL), owed);
    }
    emit Executed(assets, amounts, premiums);
    return true;
  }

  /// @notice Rescue any leftover tokens to caller
  function sweep(address token) external {
    uint256 bal = IERC20(token).balanceOf(address(this));
    IERC20(token).safeTransfer(msg.sender, bal);
  }
}
