import { TestEnv, SignerWithAddress } from './make-suite';
import {
  approve,
  deposit,
  borrow,
  withdraw,
  repay,
  setUseAsCollateral,
  swapBorrowRateMode,
  rebalanceStableBorrowRate,
  delegateBorrowAllowance,
} from '../../test-aave/helpers/actions';
import { RateMode } from '../../../helpers/types';
import { mintTokens, setAggregatorPrice, setLiquidationWhitelist } from './mint-tokens';
import { convertToCurrencyDecimals } from '../../../helpers/contracts-helpers';
import { parseUnits } from 'ethers/lib/utils';

const chai = require('chai');
const { expect } = chai;

export interface Action {
  name: string;
  args?: any;
  expected: string;
  revertMessage?: string;
}

export interface Story {
  description: string;
  actions: Action[];
}

export interface Scenario {
  title: string;
  description: string;
  stories: Story[];
}

export const executeStory = async (story: Story, testEnv: TestEnv) => {
  for (const action of story.actions) {
    const { users } = testEnv;
    await executeAction(action, users, testEnv);
  }
};

const executeAction = async (action: Action, users: SignerWithAddress[], testEnv: TestEnv) => {
  const { reserve, user: userIndex, borrowRateMode } = action.args;
  const { name, expected, revertMessage } = action;

  if (!name || name === '') {
    throw 'Action name is missing';
  }
  if (!reserve || reserve === '') {
    throw 'Invalid reserve selected for deposit';
  }
  if (!userIndex || userIndex === '') {
    throw `Invalid user selected to deposit into the ${reserve} reserve`;
  }

  if (!expected || expected === '') {
    throw `An expected resut for action ${name} is required`;
  }

  let rateMode: string = RateMode.None;

  if (borrowRateMode) {
    if (borrowRateMode === 'none') {
      rateMode = RateMode.None;
    } else if (borrowRateMode === 'stable') {
      rateMode = RateMode.Stable;
    } else if (borrowRateMode === 'variable') {
      rateMode = RateMode.Variable;
    } else {
      //random value, to test improper selection of the parameter
      rateMode = '4';
    }
  }

  const user = users[parseInt(userIndex)];

  switch (name) {
    case 'mint':
      const { amount } = action.args;

      if (!amount || amount === '') {
        throw `Invalid amount of ${reserve} to mint`;
      }

      // Use mintTokens approach from deposit-borrow.spec.ts
      const token = (testEnv as any)[reserve.toLowerCase()];
      if (!token) {
        throw `Token ${reserve} not found in testEnv`;
      }
      const mintAmount = await convertToCurrencyDecimals(token.address, amount);
      await mintTokens(token, user.address, mintAmount, user.signer);
      break;

    case 'approve':
      await approve(reserve, user, testEnv);
      break;

    case 'deposit':
      {
        const { amount, sendValue, onBehalfOf: onBehalfOfIndex } = action.args;
        const onBehalfOf = onBehalfOfIndex
          ? users[parseInt(onBehalfOfIndex)].address
          : user.address;

        if (!amount || amount === '') {
          throw `Invalid amount to deposit into the ${reserve} reserve`;
        }

        await deposit(
          reserve,
          amount,
          user,
          onBehalfOf,
          sendValue,
          expected,
          testEnv,
          revertMessage
        );
      }
      break;

    case 'delegateBorrowAllowance':
      {
        const { amount, toUser: toUserIndex } = action.args;
        const toUser = users[parseInt(toUserIndex, 10)].address;
        if (!amount || amount === '') {
          throw `Invalid amount to deposit into the ${reserve} reserve`;
        }

        await delegateBorrowAllowance(
          reserve,
          amount,
          rateMode,
          user,
          toUser,
          expected,
          testEnv,
          revertMessage
        );
      }
      break;

    case 'withdraw':
      {
        const { amount } = action.args;

        if (!amount || amount === '') {
          throw `Invalid amount to withdraw from the ${reserve} reserve`;
        }

        await withdraw(reserve, amount, user, expected, testEnv, revertMessage);
      }
      break;
    case 'borrow':
      {
        const { amount, timeTravel, onBehalfOf: onBehalfOfIndex } = action.args;

        const onBehalfOf = onBehalfOfIndex
          ? users[parseInt(onBehalfOfIndex)].address
          : user.address;

        if (!amount || amount === '') {
          throw `Invalid amount to borrow from the ${reserve} reserve`;
        }

        await borrow(
          reserve,
          amount,
          rateMode,
          user,
          onBehalfOf,
          timeTravel,
          expected,
          testEnv,
          revertMessage
        );
      }
      break;

    case 'repay':
      {
        const { amount, borrowRateMode, sendValue } = action.args;
        let { onBehalfOf: onBehalfOfIndex } = action.args;

        if (!amount || amount === '') {
          throw `Invalid amount to repay into the ${reserve} reserve`;
        }

        let userToRepayOnBehalf: SignerWithAddress;
        if (!onBehalfOfIndex || onBehalfOfIndex === '') {
          console.log(
            'WARNING: No onBehalfOf specified for a repay action. Defaulting to the repayer address'
          );
          userToRepayOnBehalf = user;
        } else {
          userToRepayOnBehalf = users[parseInt(onBehalfOfIndex)];
        }

        await repay(
          reserve,
          amount,
          rateMode,
          user,
          userToRepayOnBehalf,
          sendValue,
          expected,
          testEnv,
          revertMessage
        );
      }
      break;

    case 'setUseAsCollateral':
      {
        const { useAsCollateral } = action.args;

        if (!useAsCollateral || useAsCollateral === '') {
          throw `A valid value for useAsCollateral needs to be set when calling setUseReserveAsCollateral on reserve ${reserve}`;
        }
        await setUseAsCollateral(reserve, user, useAsCollateral, expected, testEnv, revertMessage);
      }
      break;

    case 'swapBorrowRateMode':
      await swapBorrowRateMode(reserve, user, rateMode, expected, testEnv, revertMessage);
      break;

    case 'rebalanceStableBorrowRate':
      {
        const { target: targetIndex } = action.args;

        if (!targetIndex || targetIndex === '') {
          throw `A target must be selected when trying to rebalance a stable rate`;
        }
        const target = users[parseInt(targetIndex)];

        await rebalanceStableBorrowRate(reserve, user, target, expected, testEnv, revertMessage);
      }
      break;

    case 'setPrice':
      {
        const { price } = action.args;
        if (!price || price === '') {
          throw `Invalid price for setPrice action on ${reserve}`;
        }
        const priceToken = (testEnv as any)[reserve.toLowerCase()];
        if (!priceToken) throw `Token ${reserve} not found in testEnv`;
        const { oracle } = testEnv;
        await setAggregatorPrice(oracle, priceToken.address, parseUnits(price, 8).toString());
      }
      break;

    case 'setLiquidationWhitelist':
      {
        const { target: targetIndex, allowed } = action.args;
        if (!targetIndex || targetIndex === '') {
          throw `Invalid target user for setLiquidationWhitelist`;
        }
        const targetUser = users[parseInt(targetIndex)];
        const { configurator, addressesProvider } = testEnv;
        await setLiquidationWhitelist(configurator, addressesProvider, targetUser.address, allowed === 'true');
      }
      break;

    case 'liquidationCall':
      {
        const { collateral, amount, borrower: borrowerIndex, receiveAToken } = action.args;
        if (!collateral || collateral === '') {
          throw `Invalid collateral asset for liquidation`;
        }
        if (!amount || amount === '') {
          throw `Invalid amount to liquidate`;
        }
        if (!borrowerIndex || borrowerIndex === '') {
          throw `Invalid borrower index for liquidation`;
        }

        const borrowerUser = users[parseInt(borrowerIndex)];
        const collateralToken = (testEnv as any)[collateral.toLowerCase()];
        const debtToken = (testEnv as any)[reserve.toLowerCase()];

        if (!collateralToken) throw `Collateral token ${collateral} not found in testEnv`;
        if (!debtToken) throw `Debt token ${reserve} not found in testEnv`;

        const amountToLiquidate = await convertToCurrencyDecimals(debtToken.address, amount);
        const { pool } = testEnv;
        const receive = receiveAToken === 'true';

        if (expected === 'revert') {
          await expect(
            pool.connect(user.signer).liquidationCall(
              collateralToken.address,
              debtToken.address,
              borrowerUser.address,
              amountToLiquidate,
              receive
            )
          ).to.be.revertedWith(revertMessage || '');
        } else {
          await pool.connect(user.signer).liquidationCall(
            collateralToken.address,
            debtToken.address,
            borrowerUser.address,
            amountToLiquidate,
            receive
          );
        }
      }
      break;

    default:
      throw `Invalid action requested: ${name}`;
  }
};
