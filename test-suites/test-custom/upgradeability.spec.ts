import { expect } from 'chai';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { ProtocolErrors, eContractid } from '../../helpers/types';
import { getEthersSigners } from '../../helpers/contracts-helpers';
import { MockAToken } from '../../types/MockAToken';
import { MockStableDebtToken } from '../../types/MockStableDebtToken';
import { MockVariableDebtToken } from '../../types/MockVariableDebtToken';
import { ZERO_ADDRESS } from '../../helpers/constants';
import {
  getAToken,
  getMockStableDebtToken,
  getMockVariableDebtToken,
} from '../../helpers/contracts-getters';
import {
  deployMockAToken,
  deployMockStableDebtToken,
  deployMockVariableDebtToken,
} from '../../helpers/contracts-deployments';
import { getAdminSigner, stopImpersonatingAdmin } from './helpers/mint-tokens';
import { MockATokenFactory } from '../../types/MockATokenFactory';
import { MockStableDebtTokenFactory } from '../../types/MockStableDebtTokenFactory';
import { MockVariableDebtTokenFactory } from '../../types/MockVariableDebtTokenFactory';

makeSuite('Upgradeability', (testEnv: TestEnv) => {
  const { CALLER_NOT_POOL_ADMIN } = ProtocolErrors;
  let newATokenAddress: string;
  let newStableTokenAddress: string;
  let newVariableTokenAddress: string;

  // 업그레이드 후 기대하는 토큰 이름/심볼
  const UPDATED_ATOKEN_NAME = 'Aave Interest bearing AGT updated';
  const UPDATED_ATOKEN_SYMBOL = 'aAGT';
  const UPDATED_STABLE_DEBT_NAME = 'Aave stable debt bearing AGT updated';
  const UPDATED_STABLE_DEBT_SYMBOL = 'stableDebtAGT';
  const UPDATED_VARIABLE_DEBT_NAME = 'Aave variable debt bearing AGT updated';
  const UPDATED_VARIABLE_DEBT_SYMBOL = 'variableDebtAGT';

  before('deploying instances', async () => {
    const { agt, pool } = testEnv;

    if (process.env.USE_DEPLOYED) {
      // USE_DEPLOYED 모드: initialize 없이 implementation만 배포
      // updateAToken이 proxy를 통해 initialize를 호출할 것임
      const [deployer] = await getEthersSigners();

      const aTokenInstance = await new MockATokenFactory(deployer).deploy();
      await aTokenInstance.deployTransaction.wait();

      const stableDebtTokenInstance = await new MockStableDebtTokenFactory(deployer).deploy();
      await stableDebtTokenInstance.deployTransaction.wait();

      const variableDebtTokenInstance = await new MockVariableDebtTokenFactory(deployer).deploy();
      await variableDebtTokenInstance.deployTransaction.wait();

      newATokenAddress = aTokenInstance.address;
      newStableTokenAddress = stableDebtTokenInstance.address;
      newVariableTokenAddress = variableDebtTokenInstance.address;
    } else {
      // 로컬 모드: 기존 방식대로 배포 + initialize
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
    }
  });

  it('Tries to update the AGT Atoken implementation with a different address than the lendingPoolManager', async () => {
    const { agt, configurator, users, helpersContract } = testEnv;

    // 현재 배포된 aToken에서 treasury 주소 가져오기
    const { aTokenAddress } = await helpersContract.getReserveTokensAddresses(agt.address);
    const currentAToken = await getAToken(aTokenAddress);
    const treasuryAddress = await currentAToken.RESERVE_TREASURY_ADDRESS();

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
      treasury: treasuryAddress,
      incentivesController: ZERO_ADDRESS,
      name: UPDATED_ATOKEN_NAME,
      symbol: UPDATED_ATOKEN_SYMBOL,
      implementation: newATokenAddress,
      params: "0x10"
    };
    await expect(
      configurator.connect(users[1].signer).updateAToken(updateATokenInputParams)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Upgrades the AGT Atoken implementation ', async () => {
    const { agt, configurator, helpersContract, addressesProvider } = testEnv;

    // 현재 배포된 aToken에서 treasury 주소 가져오기
    const { aTokenAddress: currentATokenAddress } = await helpersContract.getReserveTokensAddresses(agt.address);
    const currentAToken = await getAToken(currentATokenAddress);
    const treasuryAddress = await currentAToken.RESERVE_TREASURY_ADDRESS();

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
      treasury: treasuryAddress,
      incentivesController: ZERO_ADDRESS,
      name: UPDATED_ATOKEN_NAME,
      symbol: UPDATED_ATOKEN_SYMBOL,
      implementation: newATokenAddress,
      params: "0x10"
    };

    const adminSigner = await getAdminSigner(addressesProvider);
    await configurator.connect(adminSigner).updateAToken(updateATokenInputParams);
    await stopImpersonatingAdmin(addressesProvider);


    const { aTokenAddress } = await helpersContract.getReserveTokensAddresses(agt.address);
    const aToken = await getAToken(aTokenAddress);
    const tokenName = await aToken.name();

    expect(tokenName).to.be.eq(UPDATED_ATOKEN_NAME, 'Invalid token name');
  });

  it('Tries to update the AGT Stable debt token implementation with a different address than the lendingPoolManager', async () => {
    const { agt, configurator, users } = testEnv;

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
      name: UPDATED_STABLE_DEBT_NAME,
      symbol: UPDATED_STABLE_DEBT_SYMBOL,
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
    const { agt, configurator, helpersContract, addressesProvider } = testEnv;

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
      name: UPDATED_STABLE_DEBT_NAME,
      symbol: UPDATED_STABLE_DEBT_SYMBOL,
      implementation: newStableTokenAddress,
      params: '0x10'
    }

    const adminSigner = await getAdminSigner(addressesProvider);
    await configurator.connect(adminSigner).updateStableDebtToken(updateDebtTokenInput);
    await stopImpersonatingAdmin(addressesProvider);

    const { stableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(agt.address);

    const debtToken = await getMockStableDebtToken(stableDebtTokenAddress);

    const tokenName = await debtToken.name();

    expect(tokenName).to.be.eq(UPDATED_STABLE_DEBT_NAME, 'Invalid token name');
  });

  it('Tries to update the AGT variable debt token implementation with a different address than the lendingPoolManager', async () => {
    const {agt, configurator, users} = testEnv;

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
      name: UPDATED_VARIABLE_DEBT_NAME,
      symbol: UPDATED_VARIABLE_DEBT_SYMBOL,
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
    const {agt, configurator, helpersContract, addressesProvider} = testEnv;

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
      name: UPDATED_VARIABLE_DEBT_NAME,
      symbol: UPDATED_VARIABLE_DEBT_SYMBOL,
      implementation: newVariableTokenAddress,
      params: '0x10'
    }

    const adminSigner = await getAdminSigner(addressesProvider);
    await configurator.connect(adminSigner).updateVariableDebtToken(updateDebtTokenInput);
    await stopImpersonatingAdmin(addressesProvider);

    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      agt.address
    );

    const debtToken = await getMockVariableDebtToken(variableDebtTokenAddress);

    const tokenName = await debtToken.name();

    expect(tokenName).to.be.eq(UPDATED_VARIABLE_DEBT_NAME, 'Invalid token name');
  });
});
