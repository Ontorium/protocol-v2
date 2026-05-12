// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

interface IPriceOracleSentinel {
  function isBorrowAllowed() external view returns (bool);

  function isLiquidationAllowed() external view returns (bool);
}
