import { task } from 'hardhat/config';
import { checkVerification } from '../../helpers/etherscan-verification';
import {
  ConfigNames,
  getGenesisPoolAdmin,
  getQuoteCurrency,
  loadPoolConfig,
} from '../../helpers/configuration';
import { printContracts, waitForTx } from '../../helpers/misc-utils';
import {
  getLendingPoolAddressesProvider,
  getLendingPoolConfiguratorProxy,
  getPairsTokenAggregator,
} from '../../helpers/contracts-getters';
import {
  deployPriceOracle,
  deployLendingRateOracle,
  deployAaveOracle,
} from '../../helpers/contracts-deployments';
import {
  setInitialAssetPricesInOracle,
  deployAllMockAggregators,
  setInitialMarketRatesInRatesOracleByHelper,
} from '../../helpers/oracles-helpers';
import { getParamPerNetwork } from '../../helpers/contracts-helpers';
import { eNetwork, ICommonConfiguration, tEthereumAddress } from '../../helpers/types';

task('custom:testnet', 'Deploy Custom market to testnet (Arbitrum Sepolia)')
  .addFlag('verify', 'Verify contracts at Etherscan/Arbiscan')
  .addFlag('skipRegistry', 'Skip addresses provider registration at Addresses Provider Registry')
  .setAction(async ({ verify, skipRegistry }, DRE) => {
    const POOL_NAME = ConfigNames.Custom;
    await DRE.run('set-DRE');

    // Prevent loss of gas verifying all the needed ENVs for Etherscan verification
    if (verify) {
      checkVerification();
    }

    console.log('Custom Market Testnet Migration started\n');
    console.log('Network:', DRE.network.name);

    const config = loadPoolConfig(POOL_NAME);
    const network = process.env.FORK
      ? (process.env.FORK as eNetwork)
      : (DRE.network.name as eNetwork);

    console.log('0. Deploy address provider registry');
    await DRE.run('full:deploy-address-provider-registry', { pool: POOL_NAME });

    console.log('1. Deploy address provider');
    await DRE.run('full:deploy-address-provider', { pool: POOL_NAME, skipRegistry });

    console.log('2. Deploy lending pool');
    await DRE.run('full:deploy-lending-pool', { pool: POOL_NAME });

    console.log('3. Deploy oracles (Custom market - using mock aggregators)');
    // Custom market uses mock price oracles instead of Chainlink
    const {
      Mocks: { AllAssetsInitialPrices },
      ProtocolGlobalParams: { UsdAddress, MockUsdPriceInWei },
      LendingRateOracleRatesCommon,
      OracleQuoteCurrency,
      OracleQuoteUnit,
      ReserveAssets,
    } = config as ICommonConfiguration;

    const addressesProvider = await getLendingPoolAddressesProvider();
    const admin = await getGenesisPoolAdmin(config);

    // Get reserve assets for the target network
    const reserveAssets = getParamPerNetwork(ReserveAssets, network);
    console.log('Reserve assets for network:', network, reserveAssets);

    // Deploy PriceOracle (fallback)
    const fallbackOracle = await deployPriceOracle(verify);
    await waitForTx(await fallbackOracle.setEthUsdPrice(MockUsdPriceInWei));

    // Set initial prices
    const tokenAddressesForOracle: { [key: string]: string } = {
      ...reserveAssets,
      USD: UsdAddress,
    };
    await setInitialAssetPricesInOracle(
      AllAssetsInitialPrices,
      tokenAddressesForOracle,
      fallbackOracle
    );

    // Deploy mock aggregators
    const mockAggregators = await deployAllMockAggregators(AllAssetsInitialPrices, verify);

    // Build aggregator addresses
    const allAggregatorsAddresses = Object.entries(mockAggregators).reduce(
      (accum: { [tokenSymbol: string]: tEthereumAddress }, [tokenSymbol, aggregator]) => ({
        ...accum,
        [tokenSymbol]: aggregator,
      }),
      {}
    );

    const [tokens, aggregators] = getPairsTokenAggregator(
      reserveAssets as { [symbol: string]: tEthereumAddress },
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

    // Deploy LendingRateOracle
    const lendingRateOracle = await deployLendingRateOracle(verify);

    // Set lending rate oracle rates
    await setInitialMarketRatesInRatesOracleByHelper(
      LendingRateOracleRatesCommon,
      reserveAssets as { [symbol: string]: tEthereumAddress },
      lendingRateOracle,
      admin
    );

    // Set oracles in addresses provider
    await waitForTx(await addressesProvider.setPriceOracle(aaveOracle.address));
    await waitForTx(await addressesProvider.setLendingRateOracle(lendingRateOracle.address));

    console.log('Aave Oracle:', aaveOracle.address);
    console.log('Lending Rate Oracle:', lendingRateOracle.address);

    console.log('4. Deploy Data Provider');
    await DRE.run('full:data-provider', { pool: POOL_NAME });

    console.log('5. Initialize lending pool');
    await DRE.run('full:initialize-lending-pool', { pool: POOL_NAME });

    // Get emergency admin from addressesProvider (not config) to ensure correct address
    const emergencyAdminAddress = await addressesProvider.getEmergencyAdmin();
    console.log('Emergency Admin from AddressesProvider:', emergencyAdminAddress);
    const emergencyAdmin = await DRE.ethers.getSigner(emergencyAdminAddress);
    const poolConfigurator = await getLendingPoolConfiguratorProxy();
    await poolConfigurator.connect(emergencyAdmin).setPoolPause(false);
    console.log('Finished deployment, unpaused protocol');

    if (verify) {
      printContracts();
      console.log('6. Verifying contracts');
      await DRE.run('verify:general', { all: true, pool: POOL_NAME });

      console.log('7. Verifying aTokens and debtTokens');
      await DRE.run('verify:tokens', { pool: POOL_NAME });
    }

    console.log('\nFinished Custom market testnet migrations');
    printContracts();
  });
