import { expect } from 'chai';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { ProtocolErrors, eContractid } from '../../helpers/types';
import { deployContract, getContract } from '../../helpers/contracts-helpers';
import { MockAToken } from '../../types/MockAToken';
import { MockStableDebtToken } from '../../types/MockStableDebtToken';
import { MockVariableDebtToken } from '../../types/MockVariableDebtToken';
import { ZERO_ADDRESS } from '../../helpers/constants';
import {
  getAToken,
  getMockStableDebtToken,
  getMockVariableDebtToken,
  getStableDebtToken,
  getVariableDebtToken,
} from '../../helpers/contracts-getters';
import {
  deployMockAToken,
  deployMockStableDebtToken,
  deployMockVariableDebtToken,
} from '../../helpers/contracts-deployments';

makeSuite('Upgradeability', (testEnv: TestEnv) => {
  const { CALLER_NOT_POOL_ADMIN } = ProtocolErrors;
  let newATokenAddress: string;
  let newStableTokenAddress: string;
  let newVariableTokenAddress: string;

  before('deploying instances', async () => {
    const { agt, pool } = testEnv;
    const aTokenInstance = await deployMockAToken([
      pool.address,
      agt.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      'Aave Interest bearing AGT updated',
      'aAGT',
      '0x10'
    ]);

    const stableDebtTokenInstance = await deployMockStableDebtToken([
      pool.address,
      agt.address,
      ZERO_ADDRESS,
      'Aave stable debt bearing AGT updated',
      'stableDebtAGT',
      '0x10'
    ]);

    const variableDebtTokenInstance = await deployMockVariableDebtToken([
      pool.address,
      agt.address,
      ZERO_ADDRESS,
      'Aave variable debt bearing AGT updated',
      'variableDebtAGT',
      '0x10'
    ]);

    newATokenAddress = aTokenInstance.address;
    newVariableTokenAddress = variableDebtTokenInstance.address;
    newStableTokenAddress = stableDebtTokenInstance.address;
  });

  it('Tries to update the AGT Atoken implementation with a different address than the lendingPoolManager', async () => {
    const { agt, configurator, users } = testEnv;

    const name = await (await getAToken(newATokenAddress)).name();
    const symbol = await (await getAToken(newATokenAddress)).symbol();

    const updateATokenInputParams: {
      asset: string;
      treasury: string;
      incentivesController: string;
      name: string;
      symbol: string;
      implementation: string;
      params: string
    } = {
      asset: agt.address,
      treasury: ZERO_ADDRESS,
      incentivesController: ZERO_ADDRESS,
      name: name,
      symbol: symbol,
      implementation: newATokenAddress,
      params: "0x10"
    };
    await expect(
      configurator.connect(users[1].signer).updateAToken(updateATokenInputParams)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Upgrades the AGT Atoken implementation ', async () => {
    const { agt, configurator, aAGT } = testEnv;

    const name = await (await getAToken(newATokenAddress)).name();
    const symbol = await (await getAToken(newATokenAddress)).symbol();

    const updateATokenInputParams: {
      asset: string;
      treasury: string;
      incentivesController: string;
      name: string;
      symbol: string;
      implementation: string;
      params: string
    } = {
      asset: agt.address,
      treasury: ZERO_ADDRESS,
      incentivesController: ZERO_ADDRESS,
      name: name,
      symbol: symbol,
      implementation: newATokenAddress,
      params: "0x10"
    };
    await configurator.updateAToken(updateATokenInputParams);

    const tokenName = await aAGT.name();

    expect(tokenName).to.be.eq('Aave Interest bearing AGT updated', 'Invalid token name');
  });

  it('Tries to update the AGT Stable debt token implementation with a different address than the lendingPoolManager', async () => {
    const { agt, configurator, users } = testEnv;

    const name = await (await getStableDebtToken(newStableTokenAddress)).name();
    const symbol = await (await getStableDebtToken(newStableTokenAddress)).symbol();


    const updateDebtTokenInput: {
      asset: string;
      incentivesController: string;
      name: string;
      symbol: string;
      implementation: string;
      params: string;
    } = {
      asset: agt.address,
      incentivesController: ZERO_ADDRESS,
      name: name,
      symbol: symbol,
      implementation: newStableTokenAddress,
      params: '0x10'
    }

    await expect(
      configurator
        .connect(users[1].signer)
        .updateStableDebtToken(updateDebtTokenInput)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Upgrades the AGT stable debt token implementation ', async () => {
    const { agt, configurator, pool, helpersContract } = testEnv;

    const name = await (await getStableDebtToken(newStableTokenAddress)).name();
    const symbol = await (await getStableDebtToken(newStableTokenAddress)).symbol();


    const updateDebtTokenInput: {
      asset: string;
      incentivesController: string;
      name: string;
      symbol: string;
      implementation: string;
      params: string;
    } = {
      asset: agt.address,
      incentivesController: ZERO_ADDRESS,
      name: name,
      symbol: symbol,
      implementation: newStableTokenAddress,
      params: '0x10'
    }

    await configurator.updateStableDebtToken(updateDebtTokenInput);

    const { stableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(agt.address);

    const debtToken = await getMockStableDebtToken(stableDebtTokenAddress);

    const tokenName = await debtToken.name();

    expect(tokenName).to.be.eq('Aave stable debt bearing AGT updated', 'Invalid token name');
  });

  it('Tries to update the AGT variable debt token implementation with a different address than the lendingPoolManager', async () => {
    const {agt, configurator, users} = testEnv;

    const name = await (await getVariableDebtToken(newVariableTokenAddress)).name();
    const symbol = await (await getVariableDebtToken(newVariableTokenAddress)).symbol();

    const updateDebtTokenInput: {
      asset: string;
      incentivesController: string;
      name: string;
      symbol: string;
      implementation: string;
      params: string;
    } = {
      asset: agt.address,
      incentivesController: ZERO_ADDRESS,
      name: name,
      symbol: symbol,
      implementation: newVariableTokenAddress,
      params: '0x10'
    }

    await expect(
      configurator
        .connect(users[1].signer)
        .updateVariableDebtToken(updateDebtTokenInput)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Upgrades the AGT variable debt token implementation ', async () => {
    const {agt, configurator, pool, helpersContract} = testEnv;

    const name = await (await getVariableDebtToken(newVariableTokenAddress)).name();
    const symbol = await (await getVariableDebtToken(newVariableTokenAddress)).symbol();

    const updateDebtTokenInput: {
      asset: string;
      incentivesController: string;
      name: string;
      symbol: string;
      implementation: string;
      params: string;
    } = {
      asset: agt.address,
      incentivesController: ZERO_ADDRESS,
      name: name,
      symbol: symbol,
      implementation: newVariableTokenAddress,
      params: '0x10'
    }

    await configurator.updateVariableDebtToken(updateDebtTokenInput);

    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      agt.address
    );

    const debtToken = await getMockVariableDebtToken(variableDebtTokenAddress);

    const tokenName = await debtToken.name();

    expect(tokenName).to.be.eq('Aave variable debt bearing AGT updated', 'Invalid token name');
  });
});
