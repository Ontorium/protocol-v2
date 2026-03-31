import { task } from 'hardhat/config';
import { checkVerification } from '../../helpers/etherscan-verification';
import {
  ConfigNames,
  getQuoteCurrency,
  getTreasuryAddress,
  loadPoolConfig,
} from '../../helpers/configuration';
import { printContracts, waitForTx } from '../../helpers/misc-utils';
import {
  deployMintableERC20,
  deployPriceOracle,
  deployLendingRateOracle,
  deployAaveOracle,
  deployLendingPoolCollateralManager,
  deployMockFlashLoanReceiver,
  deployWalletBalancerProvider,
  deployAaveProtocolDataProvider,
} from '../../helpers/contracts-deployments';
import {
  insertContractAddressInDb,
  registerContractInJsonDb,
} from '../../helpers/contracts-helpers';
import {
  setInitialAssetPricesInOracle,
  deployAllMockAggregators,
  setInitialMarketRatesInRatesOracleByHelper,
} from '../../helpers/oracles-helpers';
import {
  getLendingPoolAddressesProvider,
  getPairsTokenAggregator,
  getLendingPoolConfiguratorProxy,
} from '../../helpers/contracts-getters';
import { eContractid, tEthereumAddress } from '../../helpers/types';
import { ZERO_ADDRESS } from '../../helpers/constants';
import { initReservesByHelper, configureReservesByHelper } from '../../helpers/init-helpers';

task('custom:dev', 'Deploy Custom market (AGT, USDC, USDT) development environment')
  .addFlag('verify', 'Verify contracts at Etherscan')
  .addFlag('skipRegistry', 'Skip registry deployment (for fork testing)')
  .setAction(async ({ verify, skipRegistry }, localBRE) => {
    const POOL_NAME = ConfigNames.Custom;

    await localBRE.run('set-DRE');

    // Prevent loss of gas verifying all the needed ENVs for Etherscan verification
    if (verify) {
      checkVerification();
    }

    const config = loadPoolConfig(POOL_NAME);
    const {
      Mocks: { AllAssetsInitialPrices },
      ProtocolGlobalParams: { UsdAddress, MockUsdPriceInWei },
      LendingRateOracleRatesCommon,
      OracleQuoteCurrency,
      OracleQuoteUnit,
      ATokenNamePrefix,
      StableDebtTokenNamePrefix,
      VariableDebtTokenNamePrefix,
      SymbolPrefix,
      ReservesConfig,
    } = config;

    console.log('Migration started\n');

    // Deploy only Custom market tokens (AGT, USDC, USDT)
    console.log('1. Deploy Custom market mock tokens (AGT, USDC, USDT)');
    const customTokens = Object.keys(config.ReservesConfig);
    const mockTokens: { [symbol: string]: { address: string } } = {};

    for (const tokenSymbol of customTokens) {
      const decimals = config.ReservesConfig[tokenSymbol].reserveDecimals;
      const token = await deployMintableERC20([tokenSymbol, tokenSymbol, decimals], verify);
      await registerContractInJsonDb(tokenSymbol.toUpperCase(), token);
      mockTokens[tokenSymbol] = { address: token.address };
      console.log(`  - Deployed ${tokenSymbol} with ${decimals} decimals at ${token.address}`);
    }

    console.log('2. Deploy address provider');
    await localBRE.run('dev:deploy-address-provider', { verify });

    console.log('3. Deploy lending pool');
    await localBRE.run('dev:deploy-lending-pool', { verify, pool: POOL_NAME });

    console.log('4. Deploy oracles (Custom market specific)');
    const addressesProvider = await getLendingPoolAddressesProvider();
    const admin = await addressesProvider.getPoolAdmin();

    // Deploy PriceOracle (fallback)
    const fallbackOracle = await deployPriceOracle(verify);
    await waitForTx(await fallbackOracle.setEthUsdPrice(MockUsdPriceInWei));

    // Set initial prices for Custom market tokens only
    const tokenAddressesForOracle: { [key: string]: string } = {
      AGT: mockTokens.AGT.address,
      USDC: mockTokens.USDC.address,
      USDT: mockTokens.USDT.address,
      USD: UsdAddress,
    };
    await setInitialAssetPricesInOracle(
      AllAssetsInitialPrices,
      tokenAddressesForOracle,
      fallbackOracle
    );

    // Deploy mock aggregators
    const mockAggregators = await deployAllMockAggregators(AllAssetsInitialPrices, verify);

    // Build token addresses and aggregator addresses
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
      OracleQuoteCurrency
    );

    // Deploy AaveOracle
    const aaveOracle = await deployAaveOracle(
      [
        tokens,
        aggregators,
        fallbackOracle.address,
        await getQuoteCurrency(config),
        OracleQuoteUnit,
      ],
      verify
    );
    await waitForTx(await addressesProvider.setPriceOracle(fallbackOracle.address));

    // Deploy LendingRateOracle
    const lendingRateOracle = await deployLendingRateOracle(verify);
    await waitForTx(await addressesProvider.setLendingRateOracle(lendingRateOracle.address));

    // Set lending rate oracle rates
    await setInitialMarketRatesInRatesOracleByHelper(
      LendingRateOracleRatesCommon,
      allTokenAddresses,
      lendingRateOracle,
      admin
    );

    // Set AaveOracle as the price oracle
    await waitForTx(await addressesProvider.setPriceOracle(aaveOracle.address));

    console.log('5. Initialize lending pool (Custom market specific)');

    // Deploy AaveProtocolDataProvider
    const testHelpers = await deployAaveProtocolDataProvider(addressesProvider.address, verify);
    await insertContractAddressInDb(eContractid.AaveProtocolDataProvider, testHelpers.address);

    const treasuryAddress = await getTreasuryAddress(config);

    // Initialize reserves with Custom market tokens only
    await initReservesByHelper(
      ReservesConfig,
      allTokenAddresses,
      ATokenNamePrefix,
      StableDebtTokenNamePrefix,
      VariableDebtTokenNamePrefix,
      SymbolPrefix,
      admin,
      treasuryAddress,
      ZERO_ADDRESS,
      POOL_NAME,
      verify
    );

    // Configure reserves
    await configureReservesByHelper(ReservesConfig, allTokenAddresses, testHelpers, admin);

    // Deploy collateral manager
    const collateralManager = await deployLendingPoolCollateralManager(verify);
    await waitForTx(
      await addressesProvider.setLendingPoolCollateralManager(collateralManager.address)
    );

    // Deploy mock flash loan receiver
    await deployMockFlashLoanReceiver(addressesProvider.address, verify);

    // Deploy wallet balance provider
    await deployWalletBalancerProvider(verify);

    // Unpause pool
    const poolConfigurator = await getLendingPoolConfiguratorProxy();
    await waitForTx(await poolConfigurator.setPoolPause(false));

    console.log('\nFinished migration');
    printContracts();
  });
