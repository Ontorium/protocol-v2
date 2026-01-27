import { expect } from 'chai';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { ProtocolErrors } from '../../helpers/types';
import { ZERO_ADDRESS } from '../../helpers/constants';
import {
  getAToken,
  getStableDebtToken,
  getVariableDebtToken,
} from '../../helpers/contracts-getters';
import { getAdminSigner, stopImpersonatingAdmin } from './helpers/mint-tokens';
import {
  deployMockAToken,
  deployMockStableDebtToken,
  deployMockVariableDebtToken,
} from '../../helpers/contracts-deployments';
import { DRE } from '../../helpers/misc-utils';
import { ethers } from 'ethers';

makeSuite('Upgradeability', (testEnv: TestEnv) => {
  const { CALLER_NOT_POOL_ADMIN } = ProtocolErrors;

  // Original implementation addresses (before upgrade)
  let originalATokenImpl: string;
  let originalStableDebtImpl: string;
  let originalVariableDebtImpl: string;

  // New implementation addresses (after upgrade)
  let newATokenImplAddress: string;
  let newStableDebtImplAddress: string;
  let newVariableDebtImplAddress: string;

  // Expected token name/symbol after upgrade
  const UPDATED_ATOKEN_NAME = 'Aave Interest bearing AGT updated';
  const UPDATED_ATOKEN_SYMBOL = 'aAGT';
  const UPDATED_STABLE_DEBT_NAME = 'Aave stable debt bearing AGT updated';
  const UPDATED_STABLE_DEBT_SYMBOL = 'stableDebtAGT';
  const UPDATED_VARIABLE_DEBT_NAME = 'Aave variable debt bearing AGT updated';
  const UPDATED_VARIABLE_DEBT_SYMBOL = 'variableDebtAGT';

  before('load existing proxies and deploy new implementations', async () => {
    const { agt, pool, helpersContract } = testEnv;

    // 1. Query current implementation addresses from existing proxies
    const { aTokenAddress, stableDebtTokenAddress, variableDebtTokenAddress } =
      await helpersContract.getReserveTokensAddresses(agt.address);

    // Read implementation address from proxy's storage slot (EIP-1967)
    // Implementation slot: 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
    const implSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

    // @ts-ignore - DRE.ethers exists at runtime
    const provider = DRE.ethers.provider;
    originalATokenImpl = ethers.utils.getAddress(
      '0x' + (await provider.getStorageAt(aTokenAddress, implSlot)).slice(-40)
    );
    originalStableDebtImpl = ethers.utils.getAddress(
      '0x' + (await provider.getStorageAt(stableDebtTokenAddress, implSlot)).slice(-40)
    );
    originalVariableDebtImpl = ethers.utils.getAddress(
      '0x' + (await provider.getStorageAt(variableDebtTokenAddress, implSlot)).slice(-40)
    );

    console.log('=== Original Implementation Addresses ===');
    console.log('  aToken proxy:', aTokenAddress);
    console.log('  aToken impl:', originalATokenImpl);
    console.log('  stableDebtToken proxy:', stableDebtTokenAddress);
    console.log('  stableDebtToken impl:', originalStableDebtImpl);
    console.log('  variableDebtToken proxy:', variableDebtTokenAddress);
    console.log('  variableDebtToken impl:', originalVariableDebtImpl);
    console.log('==========================================');

    // 2. Deploy new implementations
    const aTokenInstance = await deployMockAToken([
      pool.address,
      agt.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      UPDATED_ATOKEN_NAME,
      UPDATED_ATOKEN_SYMBOL,
      '0x10'
    ]);

    const stableDebtTokenInstance = await deployMockStableDebtToken([
      pool.address,
      agt.address,
      ZERO_ADDRESS,
      UPDATED_STABLE_DEBT_NAME,
      UPDATED_STABLE_DEBT_SYMBOL,
      '0x10'
    ]);

    const variableDebtTokenInstance = await deployMockVariableDebtToken([
      pool.address,
      agt.address,
      ZERO_ADDRESS,
      UPDATED_VARIABLE_DEBT_NAME,
      UPDATED_VARIABLE_DEBT_SYMBOL,
      '0x10'
    ]);

    newATokenImplAddress = aTokenInstance.address;
    newStableDebtImplAddress = stableDebtTokenInstance.address;
    newVariableDebtImplAddress = variableDebtTokenInstance.address;

    console.log('=== New Implementation Addresses ===');
    console.log('  new aToken impl:', newATokenImplAddress);
    console.log('  new stableDebtToken impl:', newStableDebtImplAddress);
    console.log('  new variableDebtToken impl:', newVariableDebtImplAddress);
    console.log('=====================================');
  });

  it('Tries to update the AGT Atoken implementation with a different address than the lendingPoolManager', async () => {
    const { agt, configurator, users, helpersContract } = testEnv;

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
      implementation: newATokenImplAddress,
      params: "0x10"
    };
    await expect(
      configurator.connect(users[1].signer).updateAToken(updateATokenInputParams)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('Upgrades the AGT Atoken implementation ', async () => {
    const { agt, configurator, helpersContract, addressesProvider } = testEnv;

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
      implementation: newATokenImplAddress,
      params: "0x10"
    };

    const adminSigner = await getAdminSigner(addressesProvider);
    // Simulate with callStatic first
    await configurator.connect(adminSigner).callStatic.updateAToken(updateATokenInputParams);
    await configurator.connect(adminSigner).updateAToken(updateATokenInputParams);
    await stopImpersonatingAdmin(addressesProvider);

    // Verify implementation address after upgrade
    const implSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
    // @ts-ignore - DRE.ethers exists at runtime
    const provider = DRE.ethers.provider;
    const newImpl = ethers.utils.getAddress(
      '0x' + (await provider.getStorageAt(aTokenAddress, implSlot)).slice(-40)
    );

    console.log('  aToken impl changed:', originalATokenImpl, '->', newImpl);
    expect(newImpl).to.not.eq(originalATokenImpl, 'Implementation should have changed');
    expect(newImpl).to.eq(newATokenImplAddress, 'Implementation should match new address');

    // Also verify token name
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
      implementation: newStableDebtImplAddress,
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

    const { stableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(agt.address);

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
      implementation: newStableDebtImplAddress,
      params: '0x10'
    }

    const adminSigner = await getAdminSigner(addressesProvider);
    // Simulate with callStatic first
    await configurator.connect(adminSigner).callStatic.updateStableDebtToken(updateDebtTokenInput);
    await configurator.connect(adminSigner).updateStableDebtToken(updateDebtTokenInput);
    await stopImpersonatingAdmin(addressesProvider);

    // Verify implementation address after upgrade
    const implSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
    // @ts-ignore - DRE.ethers exists at runtime
    const provider = DRE.ethers.provider;
    const newImpl = ethers.utils.getAddress(
      '0x' + (await provider.getStorageAt(stableDebtTokenAddress, implSlot)).slice(-40)
    );

    console.log('  stableDebtToken impl changed:', originalStableDebtImpl, '->', newImpl);
    expect(newImpl).to.not.eq(originalStableDebtImpl, 'Implementation should have changed');
    expect(newImpl).to.eq(newStableDebtImplAddress, 'Implementation should match new address');

    // Also verify token name
    const debtToken = await getStableDebtToken(stableDebtTokenAddress);
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
      implementation: newVariableDebtImplAddress,
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

    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(agt.address);

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
      implementation: newVariableDebtImplAddress,
      params: '0x10'
    }

    const adminSigner = await getAdminSigner(addressesProvider);
    // Simulate with callStatic first
    await configurator.connect(adminSigner).callStatic.updateVariableDebtToken(updateDebtTokenInput);
    await configurator.connect(adminSigner).updateVariableDebtToken(updateDebtTokenInput);
    await stopImpersonatingAdmin(addressesProvider);

    // Verify implementation address after upgrade
    const implSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
    // @ts-ignore - DRE.ethers exists at runtime
    const provider = DRE.ethers.provider;
    const newImpl = ethers.utils.getAddress(
      '0x' + (await provider.getStorageAt(variableDebtTokenAddress, implSlot)).slice(-40)
    );

    console.log('  variableDebtToken impl changed:', originalVariableDebtImpl, '->', newImpl);
    expect(newImpl).to.not.eq(originalVariableDebtImpl, 'Implementation should have changed');
    expect(newImpl).to.eq(newVariableDebtImplAddress, 'Implementation should match new address');

    // Also verify token name
    const debtToken = await getVariableDebtToken(variableDebtTokenAddress);
    const tokenName = await debtToken.name();
    expect(tokenName).to.be.eq(UPDATED_VARIABLE_DEBT_NAME, 'Invalid token name');
  });
});
