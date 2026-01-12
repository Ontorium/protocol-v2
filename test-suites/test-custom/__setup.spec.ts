import rawBRE from 'hardhat';
import { MockContract } from 'ethereum-waffle';
import {
  insertContractAddressInDb,
  getEthersSigners,
  registerContractInJsonDb,
  getEthersSignersAddresses,
} from '../../helpers/contracts-helpers';
import {
  deployLendingPoolAddressesProvider,
  deployMintableERC20,
  deployLendingPoolAddressesProviderRegistry,
  deployLendingPoolConfigurator,
  deployLendingPool,
  deployPriceOracle,
  deployLendingPoolCollateralManager,
  deployMockFlashLoanReceiver,
  deployWalletBalancerProvider,
  deployAaveProtocolDataProvider,
  deployLendingRateOracle,
  deployStableAndVariableTokensHelper,
  deployATokensAndRatesHelper,
  deployATokenImplementations,
  deployAaveOracle,
} from '../../helpers/contracts-deployments';
import { Signer } from 'ethers';
import { eContractid, tEthereumAddress } from '../../helpers/types';
import { MintableERC20 } from '../../types/MintableERC20';
import {
  ConfigNames,
  getTreasuryAddress,
  loadPoolConfig,
} from '../../helpers/configuration';
import { initializeMakeSuite } from './helpers/make-suite';

import {
  setInitialAssetPricesInOracle,
  deployAllMockAggregators,
  setInitialMarketRatesInRatesOracleByHelper,
} from '../../helpers/oracles-helpers';
import { DRE, waitForTx } from '../../helpers/misc-utils';
import { initReservesByHelper, configureReservesByHelper } from '../../helpers/init-helpers';
import CustomConfig from '../../markets/custom';
import { oneEther, ZERO_ADDRESS } from '../../helpers/constants';
import {
  getLendingPool,
  getLendingPoolConfiguratorProxy,
  getPairsTokenAggregator,
} from '../../helpers/contracts-getters';

const MOCK_USD_PRICE_IN_WEI = CustomConfig.ProtocolGlobalParams.MockUsdPriceInWei;
const ALL_ASSETS_INITIAL_PRICES = CustomConfig.Mocks.AllAssetsInitialPrices;
const USD_ADDRESS = CustomConfig.ProtocolGlobalParams.UsdAddress;
const MOCK_CHAINLINK_AGGREGATORS_PRICES = CustomConfig.Mocks.AllAssetsInitialPrices;
const LENDING_RATE_ORACLE_RATES_COMMON = CustomConfig.LendingRateOracleRatesCommon;

const deployAllMockTokens = async (deployer: Signer) => {
  const tokens: { [symbol: string]: MockContract | MintableERC20 } = {};

  // Deploy only the tokens we need: AGT, USDC, USDT
  const customTokens = ['AGT', 'USDC', 'USDT'];

  for (const tokenSymbol of customTokens) {
    let decimals = 18;

    const configData = (<any>CustomConfig.ReservesConfig)[tokenSymbol];

    if (configData) {
      decimals = parseInt(configData.reserveDecimals);
    }

    tokens[tokenSymbol] = await deployMintableERC20([tokenSymbol, tokenSymbol, decimals.toString()]);
    await registerContractInJsonDb(tokenSymbol.toUpperCase(), tokens[tokenSymbol]);
  }

  return tokens;
};

const buildTestEnv = async (deployer: Signer, secondaryWallet: Signer) => {
  console.time('setup');
  const aaveAdmin = await deployer.getAddress();
  const config = loadPoolConfig(ConfigNames.Custom);
  const {
    ATokenNamePrefix,
    StableDebtTokenNamePrefix,
    VariableDebtTokenNamePrefix,
    SymbolPrefix,
    ReservesConfig,
  } = config;

  const mockTokens = await deployAllMockTokens(deployer);

  const addressesProvider = await deployLendingPoolAddressesProvider(CustomConfig.MarketId);
  await waitForTx(await addressesProvider.setPoolAdmin(aaveAdmin));

  //setting users[1] as emergency admin, which is in position 2 in the DRE addresses list
  const addressList = await getEthersSignersAddresses();

  await waitForTx(await addressesProvider.setEmergencyAdmin(addressList[2]));

  const addressesProviderRegistry = await deployLendingPoolAddressesProviderRegistry();
  await waitForTx(
    await addressesProviderRegistry.registerAddressesProvider(addressesProvider.address, 1)
  );

  const lendingPoolImpl = await deployLendingPool();

  await waitForTx(await addressesProvider.setLendingPoolImpl(lendingPoolImpl.address));

  const lendingPoolAddress = await addressesProvider.getLendingPool();
  const lendingPoolProxy = await getLendingPool(lendingPoolAddress);

  await insertContractAddressInDb(eContractid.LendingPool, lendingPoolProxy.address);

  const lendingPoolConfiguratorImpl = await deployLendingPoolConfigurator();
  await waitForTx(
    await addressesProvider.setLendingPoolConfiguratorImpl(lendingPoolConfiguratorImpl.address)
  );
  const lendingPoolConfiguratorProxy = await getLendingPoolConfiguratorProxy(
    await addressesProvider.getLendingPoolConfigurator()
  );
  await insertContractAddressInDb(
    eContractid.LendingPoolConfigurator,
    lendingPoolConfiguratorProxy.address
  );

  // Deploy deployment helpers
  await deployStableAndVariableTokensHelper([lendingPoolProxy.address, addressesProvider.address]);
  await deployATokensAndRatesHelper([
    lendingPoolProxy.address,
    addressesProvider.address,
    lendingPoolConfiguratorProxy.address,
  ]);

  const fallbackOracle = await deployPriceOracle();
  await waitForTx(await fallbackOracle.setEthUsdPrice(MOCK_USD_PRICE_IN_WEI));
  await setInitialAssetPricesInOracle(
    ALL_ASSETS_INITIAL_PRICES,
    {
      AGT: mockTokens.AGT.address,
      USDC: mockTokens.USDC.address,
      USDT: mockTokens.USDT.address,
      USD: USD_ADDRESS,
    },
    fallbackOracle
  );

  const mockAggregators = await deployAllMockAggregators(MOCK_CHAINLINK_AGGREGATORS_PRICES);

  const allTokenAddresses = Object.entries(mockTokens).reduce(
    (accum: { [tokenSymbol: string]: tEthereumAddress }, [tokenSymbol, tokenContract]) => ({
      ...accum,
      [tokenSymbol]: tokenContract.address,
    }),
    {}
  );
  const allAggregatorsAddresses = Object.entries(mockAggregators).reduce(
    (accum: { [tokenSymbol: string]: tEthereumAddress }, [tokenSymbol, aggregator]) => ({
      ...accum,
      [tokenSymbol]: aggregator,
    }),
    {}
  );

  const [tokens, aggregators] = getPairsTokenAggregator(
    allTokenAddresses,
    allAggregatorsAddresses,
    config.OracleQuoteCurrency
  );

  await deployAaveOracle([
    tokens,
    aggregators,
    fallbackOracle.address,
    ZERO_ADDRESS, // No WETH for custom market
    oneEther.toString(),
  ]);
  await waitForTx(await addressesProvider.setPriceOracle(fallbackOracle.address));

  const lendingRateOracle = await deployLendingRateOracle();
  await waitForTx(await addressesProvider.setLendingRateOracle(lendingRateOracle.address));

  const allReservesAddresses = {
    ...allTokenAddresses,
  };
  await setInitialMarketRatesInRatesOracleByHelper(
    LENDING_RATE_ORACLE_RATES_COMMON,
    allReservesAddresses,
    lendingRateOracle,
    aaveAdmin
  );
  await deployATokenImplementations(ConfigNames.Custom, ReservesConfig);

  const testHelpers = await deployAaveProtocolDataProvider(addressesProvider.address);

  await insertContractAddressInDb(eContractid.AaveProtocolDataProvider, testHelpers.address);
  const admin = await deployer.getAddress();

  console.log('Initialize configuration');

  const treasuryAddress = await getTreasuryAddress(config);

  await initReservesByHelper(
    ReservesConfig,
    allReservesAddresses,
    ATokenNamePrefix,
    StableDebtTokenNamePrefix,
    VariableDebtTokenNamePrefix,
    SymbolPrefix,
    admin,
    treasuryAddress,
    ZERO_ADDRESS,
    ConfigNames.Custom,
    false
  );
  await configureReservesByHelper(ReservesConfig, allReservesAddresses, testHelpers, admin);

  const collateralManager = await deployLendingPoolCollateralManager();
  await waitForTx(
    await addressesProvider.setLendingPoolCollateralManager(collateralManager.address)
  );
  await deployMockFlashLoanReceiver(addressesProvider.address);

  await deployWalletBalancerProvider();

  console.timeEnd('setup');
};

before(async () => {
  await rawBRE.run('set-DRE');
  const [deployer, secondaryWallet] = await getEthersSigners();
  const FORK = process.env.FORK;

  if (FORK) {
    await rawBRE.run('custom:dev', { skipRegistry: true });
  } else {
    console.log('-> Deploying test environment...');
    await buildTestEnv(deployer, secondaryWallet);
  }

  await initializeMakeSuite();
  console.log('\n***************');
  console.log('Setup and snapshot finished');
  console.log('***************\n');
});
