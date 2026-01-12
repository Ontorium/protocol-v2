import { evmRevert, evmSnapshot, DRE } from '../../../helpers/misc-utils';
import { Signer } from 'ethers';
import {
  getLendingPool,
  getLendingPoolAddressesProvider,
  getAaveProtocolDataProvider,
  getAToken,
  getMintableERC20,
  getLendingPoolConfiguratorProxy,
  getPriceOracle,
  getLendingPoolAddressesProviderRegistry,
  getWETHMocked,
} from '../../../helpers/contracts-getters';
import { tEthereumAddress } from '../../../helpers/types';
import { LendingPool } from '../../../types/LendingPool';
import { AaveProtocolDataProvider } from '../../../types/AaveProtocolDataProvider';
import { MintableERC20 } from '../../../types/MintableERC20';
import { AToken } from '../../../types/AToken';
import { LendingPoolConfigurator } from '../../../types/LendingPoolConfigurator';

import chai from 'chai';
import bignumberChai from 'chai-bignumber';
import { almostEqual } from '../../test-aave/helpers/almost-equal';
import { PriceOracle } from '../../../types/PriceOracle';
import { LendingPoolAddressesProvider } from '../../../types/LendingPoolAddressesProvider';
import { LendingPoolAddressesProviderRegistry } from '../../../types/LendingPoolAddressesProviderRegistry';
import { getEthersSigners } from '../../../helpers/contracts-helpers';
import { WETH9Mocked } from '../../../types/WETH9Mocked';
import { solidity } from 'ethereum-waffle';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

chai.use(bignumberChai());
chai.use(almostEqual());
chai.use(solidity);

export interface SignerWithAddress {
  signer: Signer;
  address: tEthereumAddress;
}

export interface TestEnv {
  deployer: SignerWithAddress;
  users: SignerWithAddress[];
  pool: LendingPool;
  configurator: LendingPoolConfigurator;
  oracle: PriceOracle;
  helpersContract: AaveProtocolDataProvider;
  weth: WETH9Mocked;
  aWETH: AToken;
  agt: MintableERC20;
  aAGT: AToken;
  usdc: MintableERC20;
  aUSDC: AToken;
  usdt: MintableERC20;
  aUSDT: AToken;
  addressesProvider: LendingPoolAddressesProvider;
  registry: LendingPoolAddressesProviderRegistry;
}

let buidlerevmSnapshotId: string = '0x1';
const setBuidlerevmSnapshotId = (id: string) => {
  buidlerevmSnapshotId = id;
};

const testEnv: TestEnv = {
  deployer: {} as SignerWithAddress,
  users: [] as SignerWithAddress[],
  pool: {} as LendingPool,
  configurator: {} as LendingPoolConfigurator,
  helpersContract: {} as AaveProtocolDataProvider,
  oracle: {} as PriceOracle,
  weth: {} as WETH9Mocked,
  aWETH: {} as AToken,
  agt: {} as MintableERC20,
  aAGT: {} as AToken,
  usdc: {} as MintableERC20,
  aUSDC: {} as AToken,
  usdt: {} as MintableERC20,
  aUSDT: {} as AToken,
  addressesProvider: {} as LendingPoolAddressesProvider,
  registry: {} as LendingPoolAddressesProviderRegistry,
} as TestEnv;

export async function initializeMakeSuite() {
  const [_deployer, ...restSigners] = await getEthersSigners();
  const deployer: SignerWithAddress = {
    address: await _deployer.getAddress(),
    signer: _deployer,
  };

  for (const signer of restSigners) {
    testEnv.users.push({
      signer,
      address: await signer.getAddress(),
    });
  }
  testEnv.deployer = deployer;
  testEnv.pool = await getLendingPool();

  testEnv.configurator = await getLendingPoolConfiguratorProxy();

  testEnv.addressesProvider = await getLendingPoolAddressesProvider();

  testEnv.oracle = await getPriceOracle();

  testEnv.helpersContract = await getAaveProtocolDataProvider();

  // Get tokens
  const allTokens = await testEnv.helpersContract.getAllATokens();
  console.log('All aTokens:', allTokens);

  // Try to find aTokens - may be 'aaAGT' or 'aAGT' depending on config
  let aAGTAddress = allTokens.find((aToken) => aToken.symbol === 'aaAGT')?.tokenAddress;
  let aUSDCAddress = allTokens.find((aToken) => aToken.symbol === 'aaUSDC')?.tokenAddress;
  let aUSDTAddress = allTokens.find((aToken) => aToken.symbol === 'aaUSDT')?.tokenAddress;

  // Fallback to 'aXXX' format if 'aaXXX' not found
  if (!aAGTAddress) {
    aAGTAddress = allTokens.find((aToken) => aToken.symbol.includes('AGT'))?.tokenAddress;
  }
  if (!aUSDCAddress) {
    aUSDCAddress = allTokens.find((aToken) => aToken.symbol.includes('USDC'))?.tokenAddress;
  }
  if (!aUSDTAddress) {
    aUSDTAddress = allTokens.find((aToken) => aToken.symbol.includes('USDT'))?.tokenAddress;
  }

  const reservesTokens = await testEnv.helpersContract.getAllReservesTokens();
  console.log('All reserves:', reservesTokens);

  const agtAddress = reservesTokens.find((token) => token.symbol === 'AGT')?.tokenAddress;
  const usdcAddress = reservesTokens.find((token) => token.symbol === 'USDC')?.tokenAddress;
  const usdtAddress = reservesTokens.find((token) => token.symbol === 'USDT')?.tokenAddress;

  if (agtAddress && aAGTAddress) {
    testEnv.agt = await getMintableERC20(agtAddress);
    testEnv.aAGT = await getAToken(aAGTAddress);
  }

  if (usdcAddress && aUSDCAddress) {
    testEnv.usdc = await getMintableERC20(usdcAddress);
    testEnv.aUSDC = await getAToken(aUSDCAddress);
  }

  if (usdtAddress && aUSDTAddress) {
    testEnv.usdt = await getMintableERC20(usdtAddress);
    testEnv.aUSDT = await getAToken(aUSDTAddress);
  }

  testEnv.registry = await getLendingPoolAddressesProviderRegistry();
}

const setSnapshot = async () => {
  const hre: HardhatRuntimeEnvironment = DRE as HardhatRuntimeEnvironment;
  setBuidlerevmSnapshotId(await evmSnapshot());
};

const revertHead = async () => {
  const hre: HardhatRuntimeEnvironment = DRE as HardhatRuntimeEnvironment;
  await evmRevert(buidlerevmSnapshotId);
};

export function makeSuite(name: string, tests: (testEnv: TestEnv) => void) {
  describe(name, () => {
    before(async () => {
      await setSnapshot();
    });
    tests(testEnv);
    after(async () => {
      await revertHead();
    });
  });
}
