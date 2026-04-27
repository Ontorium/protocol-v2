import { evmRevert, evmSnapshot, DRE, getDb } from '../../../helpers/misc-utils';
import { Signer } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
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
// @ts-ignore
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
  oxau: MintableERC20;
  aOXAU: AToken;
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
  oxau: {} as MintableERC20,
  aOXAU: {} as AToken,
  usdc: {} as MintableERC20,
  aUSDC: {} as AToken,
  usdt: {} as MintableERC20,
  aUSDT: {} as AToken,
  addressesProvider: {} as LendingPoolAddressesProvider,
  registry: {} as LendingPoolAddressesProviderRegistry,
} as TestEnv;

/**
 * Initialize test suite
 * @param addressesProviderAddress - Optional: Already deployed LendingPoolAddressesProvider address
 *                                   If set, loads other contract addresses from this provider
 */
export async function initializeMakeSuite(addressesProviderAddress?: string) {
  const [_deployer, ...restSigners] = await getEthersSigners();
  const deployer: SignerWithAddress = {
    address: await _deployer.getAddress(),
    signer: _deployer,
  };

  // Reset users array to avoid accumulation when initializeMakeSuite is called multiple times
  testEnv.users = [];
  for (const signer of restSigners) {
    testEnv.users.push({
      signer,
      address: await signer.getAddress(),
    });
  }
  testEnv.deployer = deployer;

  // USE_DEPLOYED mode: Load contract addresses from already deployed contracts
  if (addressesProviderAddress) {
    console.log('Loading contracts from AddressesProvider:', addressesProviderAddress);
    testEnv.addressesProvider = await getLendingPoolAddressesProvider(addressesProviderAddress);

    const poolAddress = await testEnv.addressesProvider.getLendingPool();
    testEnv.pool = await getLendingPool(poolAddress);

    const configuratorAddress = await testEnv.addressesProvider.getLendingPoolConfigurator();
    testEnv.configurator = await getLendingPoolConfiguratorProxy(configuratorAddress);

    const oracleAddress = await testEnv.addressesProvider.getPriceOracle();
    testEnv.oracle = await getPriceOracle(oracleAddress);

    // DataProvider cannot be retrieved directly from AddressesProvider, requires separate setup
    // Using getAddress(bytes32): keccak256("DATA_PROVIDER") = 0x...
    const dataProviderAddress = await testEnv.addressesProvider.getAddress(
      '0x0100000000000000000000000000000000000000000000000000000000000000'
    );
    if (dataProviderAddress !== '0x0000000000000000000000000000000000000000') {
      testEnv.helpersContract = await getAaveProtocolDataProvider(dataProviderAddress);
    } else {
      // Fallback: Pass DataProvider address via environment variable
      const dataProviderEnv = process.env.DATA_PROVIDER;
      if (dataProviderEnv) {
        testEnv.helpersContract = await getAaveProtocolDataProvider(dataProviderEnv);
      } else {
        throw new Error('DATA_PROVIDER address required for USE_DEPLOYED mode');
      }
    }
  } else {
    // Default mode: Load addresses from internal DB
    testEnv.pool = await getLendingPool();
    testEnv.configurator = await getLendingPoolConfiguratorProxy();
    testEnv.addressesProvider = await getLendingPoolAddressesProvider();
    testEnv.oracle = await getPriceOracle();
    testEnv.helpersContract = await getAaveProtocolDataProvider();
  }

  // Get tokens
  const allTokens = await testEnv.helpersContract.getAllATokens();
  console.log('All aTokens:', allTokens);

  // OXAU may appear with different aToken prefixes depending on config
  let aOXAUAddress = allTokens.find((aToken) => aToken.symbol === 'aaOXAU')?.tokenAddress;
  let aUSDCAddress = allTokens.find((aToken) => aToken.symbol === 'aaUSDC')?.tokenAddress;
  let aUSDTAddress = allTokens.find((aToken) => aToken.symbol === 'aaUSDT')?.tokenAddress;

  // Fallback to 'aXXX' format if 'aaXXX' not found
  if (!aOXAUAddress) {
    aOXAUAddress = allTokens.find((aToken) => aToken.symbol.includes('OXAU'))?.tokenAddress;
  }
  if (!aUSDCAddress) {
    aUSDCAddress = allTokens.find((aToken) => aToken.symbol.includes('USDC'))?.tokenAddress;
  }
  if (!aUSDTAddress) {
    aUSDTAddress = allTokens.find((aToken) => aToken.symbol.includes('USDT'))?.tokenAddress;
  }

  const reservesTokens = await testEnv.helpersContract.getAllReservesTokens();
  console.log('All reserves:', reservesTokens);

  const oxauAddress = reservesTokens.find((token) => token.symbol === 'OXAU')?.tokenAddress;
  const usdcAddress = reservesTokens.find((token) => token.symbol === 'USDC')?.tokenAddress;
  const usdtAddress = reservesTokens.find((token) => token.symbol === 'USDT')?.tokenAddress;

  if (oxauAddress && aOXAUAddress) {
    testEnv.oxau = await getMintableERC20(oxauAddress);
    testEnv.aOXAU = await getAToken(aOXAUAddress);
  }

  if (usdcAddress && aUSDCAddress) {
    testEnv.usdc = await getMintableERC20(usdcAddress);
    testEnv.aUSDC = await getAToken(aUSDCAddress);
  }

  if (usdtAddress && aUSDTAddress) {
    testEnv.usdt = await getMintableERC20(usdtAddress);
    testEnv.aUSDT = await getAToken(aUSDTAddress);
  }

  // USE_DEPLOYED mode: Register token addresses in DB used by getReserveAddressFromSymbol
  // getReserveAddressFromSymbol queries using `${symbol}.${DRE.network.name}` format
  if (addressesProviderAddress && DRE) {
    const networkName = DRE.network.name;
    const db = getDb();

    if (oxauAddress) {
      db.set(`OXAU.${networkName}`, { address: oxauAddress }).write();
    }
    if (usdcAddress) {
      db.set(`USDC.${networkName}`, { address: usdcAddress }).write();
    }
    if (usdtAddress) {
      db.set(`USDT.${networkName}`, { address: usdtAddress }).write();
    }

    // Also register LendingRateOracle address in DB (used by getLendingRateOracle)
    const lendingRateOracleAddress = await testEnv.addressesProvider.getLendingRateOracle();
    if (lendingRateOracleAddress && lendingRateOracleAddress !== '0x0000000000000000000000000000000000000000') {
      db.set(`LendingRateOracle.${networkName}`, { address: lendingRateOracleAddress }).write();
    }
  }

  // Registry lookup
  if (addressesProviderAddress) {
    // USE_DEPLOYED mode: Load registry address from deployed-contracts.json
    try {
      const deployedContractsPath = path.resolve(__dirname, '../../../deployed-contracts.json');
      const deployedContracts = JSON.parse(fs.readFileSync(deployedContractsPath, 'utf8'));
      const registryEntry = deployedContracts['LendingPoolAddressesProviderRegistry'];
      // Prefer arbitrumSepolia, fallback to other networks if not found
      const registryAddress = registryEntry?.arbitrumSepolia?.address
        || registryEntry?.hardhat?.address
        || (Object.values(registryEntry || {})[0] as any)?.address;
      if (registryAddress) {
        testEnv.registry = await getLendingPoolAddressesProviderRegistry(registryAddress);
      }
    } catch (e) {
      console.warn('Could not load registry from deployed-contracts.json:', e);
    }
  } else {
    testEnv.registry = await getLendingPoolAddressesProviderRegistry();
  }
}

const setSnapshot = async () => {
  if (process.env.USE_DEPLOYED) {
    // USE_DEPLOYED mode: Each file starts a fresh Anvil fork, so snapshots are unnecessary
    // Also, tests within a file often depend on each other sequentially
    return;
  }
  setBuidlerevmSnapshotId(await evmSnapshot());
};

const revertHead = async () => {
  if (process.env.USE_DEPLOYED) {
    // USE_DEPLOYED mode: Each file starts a fresh Anvil fork, so revert is unnecessary
    return;
  }
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
