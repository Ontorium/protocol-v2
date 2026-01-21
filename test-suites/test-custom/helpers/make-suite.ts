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

/**
 * Initialize test suite
 * @param addressesProviderAddress - Optional: 이미 배포된 LendingPoolAddressesProvider 주소
 *                                   설정하면 해당 주소에서 다른 컨트랙트 주소를 가져옴
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

  // USE_DEPLOYED 모드: 이미 배포된 컨트랙트 주소에서 가져오기
  if (addressesProviderAddress) {
    console.log('Loading contracts from AddressesProvider:', addressesProviderAddress);
    testEnv.addressesProvider = await getLendingPoolAddressesProvider(addressesProviderAddress);

    const poolAddress = await testEnv.addressesProvider.getLendingPool();
    testEnv.pool = await getLendingPool(poolAddress);

    const configuratorAddress = await testEnv.addressesProvider.getLendingPoolConfigurator();
    testEnv.configurator = await getLendingPoolConfiguratorProxy(configuratorAddress);

    const oracleAddress = await testEnv.addressesProvider.getPriceOracle();
    testEnv.oracle = await getPriceOracle(oracleAddress);

    // DataProvider는 AddressesProvider에서 직접 가져올 수 없으므로 별도 설정 필요
    // getAddress(bytes32) 사용: keccak256("DATA_PROVIDER") = 0x...
    const dataProviderAddress = await testEnv.addressesProvider.getAddress(
      '0x0100000000000000000000000000000000000000000000000000000000000000'
    );
    if (dataProviderAddress !== '0x0000000000000000000000000000000000000000') {
      testEnv.helpersContract = await getAaveProtocolDataProvider(dataProviderAddress);
    } else {
      // Fallback: 환경변수로 DataProvider 주소 전달
      const dataProviderEnv = process.env.DATA_PROVIDER;
      if (dataProviderEnv) {
        testEnv.helpersContract = await getAaveProtocolDataProvider(dataProviderEnv);
      } else {
        throw new Error('DATA_PROVIDER address required for USE_DEPLOYED mode');
      }
    }
  } else {
    // 기존 모드: 내부 DB에서 주소 가져오기
    testEnv.pool = await getLendingPool();
    testEnv.configurator = await getLendingPoolConfiguratorProxy();
    testEnv.addressesProvider = await getLendingPoolAddressesProvider();
    testEnv.oracle = await getPriceOracle();
    testEnv.helpersContract = await getAaveProtocolDataProvider();
  }

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

  // USE_DEPLOYED 모드: getReserveAddressFromSymbol이 사용하는 DB에 토큰 주소 등록
  // getReserveAddressFromSymbol은 `${symbol}.${DRE.network.name}` 형식으로 조회함
  if (addressesProviderAddress && DRE) {
    const networkName = DRE.network.name;
    const db = getDb();

    if (agtAddress) {
      db.set(`AGT.${networkName}`, { address: agtAddress }).write();
    }
    if (usdcAddress) {
      db.set(`USDC.${networkName}`, { address: usdcAddress }).write();
    }
    if (usdtAddress) {
      db.set(`USDT.${networkName}`, { address: usdtAddress }).write();
    }

    // LendingRateOracle 주소도 DB에 등록 (getLendingRateOracle이 사용)
    const lendingRateOracleAddress = await testEnv.addressesProvider.getLendingRateOracle();
    if (lendingRateOracleAddress && lendingRateOracleAddress !== '0x0000000000000000000000000000000000000000') {
      db.set(`LendingRateOracle.${networkName}`, { address: lendingRateOracleAddress }).write();
    }
  }

  // Registry lookup
  if (addressesProviderAddress) {
    // USE_DEPLOYED 모드: deployed-contracts.json에서 registry 주소 로드
    try {
      const deployedContractsPath = path.resolve(__dirname, '../../../deployed-contracts.json');
      const deployedContracts = JSON.parse(fs.readFileSync(deployedContractsPath, 'utf8'));
      const registryEntry = deployedContracts['LendingPoolAddressesProviderRegistry'];
      // arbitrumSepolia 우선, 없으면 다른 네트워크에서 찾기
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
    // USE_DEPLOYED 모드: 파일마다 새 Anvil 포크를 시작하므로 스냅샷 불필요
    // 또한 파일 내 테스트들이 순차적으로 의존하는 경우가 많음
    return;
  }
  setBuidlerevmSnapshotId(await evmSnapshot());
};

const revertHead = async () => {
  if (process.env.USE_DEPLOYED) {
    // USE_DEPLOYED 모드: 파일마다 새 Anvil 포크를 시작하므로 리버트 불필요
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
