import { task } from 'hardhat/config';
import { BigNumber } from 'ethers';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const MNEMONIC_PATH = "m/44'/60'/0'/0/0";

const parseCsv = (value: string): string[] =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

task(
  'custom:oracle-ui-flow',
  'Deploy AaveOracle, replace LendingPool oracle, run fork smoke test, and deploy UiPoolDataProviderV2'
)
  .addParam('provider', 'LendingPoolAddressesProvider address')
  .addParam('fallbackOracle', 'Fallback oracle address (e.g. PriceOracle)')
  .addOptionalParam('assets', 'Comma-separated reserve asset addresses for AaveOracle sources')
  .addOptionalParam('sources', 'Comma-separated aggregator addresses for assets')
  .addParam('priceAggregator', 'networkBaseTokenPriceInUsdProxyAggregator for UiPoolDataProviderV2')
  .addParam(
    'ethUsdAggregator',
    'marketReferenceCurrencyPriceInUsdProxyAggregator for UiPoolDataProviderV2'
  )
  .addParam('collateral', 'Collateral asset address for smoke test')
  .addParam('debt', 'Debt asset address for smoke test')
  .addOptionalParam('depositAmount', 'Deposit amount in collateral token units', '10')
  .addOptionalParam('borrowAmount', 'Borrow amount in debt token units', '10')
  .addOptionalParam(
    'baseCurrency',
    'AaveOracle base currency address. Use zero for USD',
    ZERO_ADDRESS
  )
  .addOptionalParam(
    'baseCurrencyUnit',
    'AaveOracle base currency unit. Use 1e8 for USD',
    '100000000'
  )
  .addOptionalParam('rateMode', 'Borrow rate mode. 1=stable, 2=variable', '2')
  .addFlag('verify', 'Verify deployed contracts via explorer API')
  .setAction(async (params, hre) => {
    await hre.run('set-DRE');

    const assets = parseCsv(params.assets || '');
    const sources = parseCsv(params.sources || '');
    if (assets.length !== sources.length) {
      throw new Error('assets and sources must have the same length');
    }

    const mnemonic = (process.env.MNEMONIC || '').trim();
    if (!mnemonic) {
      throw new Error('Missing MNEMONIC in environment');
    }

    const deployer = hre.ethers.Wallet.fromMnemonic(mnemonic, MNEMONIC_PATH).connect(
      hre.ethers.provider
    );
    const signerAddress = deployer.address;

    if (process.env.FORK && hre.network.name === 'hardhat') {
      // Ensure fork signer has ETH for tx fees.
      await hre.network.provider.send('hardhat_setBalance', [
        signerAddress,
        '0x8AC7230489E80000', // 10 ETH
      ]);
    }

    console.log('\n[1/4] Deploying AaveOracle...');
    const aaveOracleFactory = await hre.ethers.getContractFactory('AaveOracle', deployer);
    const aaveOracle = await aaveOracleFactory.deploy(
      assets,
      sources,
      params.fallbackOracle,
      params.baseCurrency,
      params.baseCurrencyUnit
    );
    await aaveOracle.deployTransaction.wait(1);
    console.log(`AaveOracle deployed at: ${aaveOracle.address}`);

    if (params.verify) {
      await hre.run('verify:verify', {
        address: aaveOracle.address,
        contract: 'contracts/misc/AaveOracle.sol:AaveOracle',
        constructorArguments: [
          assets,
          sources,
          params.fallbackOracle,
          params.baseCurrency,
          params.baseCurrencyUnit,
        ],
      });
    }

    console.log('\n[2/4] Replacing LendingPool price oracle...');
    const provider = await hre.ethers.getContractAt(
      'ILendingPoolAddressesProvider',
      params.provider,
      deployer
    );
    await (await provider.setPriceOracle(aaveOracle.address)).wait(1);
    const currentOracle = await provider.getPriceOracle();
    console.log(`LendingPool price oracle set to: ${currentOracle}`);

    console.log('\n[3/4] Running fork smoke test (deposit/borrow/repay/withdraw)...');
    if (!process.env.FORK || hre.network.name !== 'hardhat') {
      console.log(
        'Skipped: smoke test runs only in fork mode (--network hardhat with FORK=<network>)'
      );
    } else {
      const lendingPoolAddress = await provider.getLendingPool();
      const lendingPool = await hre.ethers.getContractAt(
        'ILendingPool',
        lendingPoolAddress,
        deployer
      );
      const collateral = await hre.ethers.getContractAt(
        'contracts/dependencies/openzeppelin/contracts/IERC20.sol:IERC20',
        params.collateral,
        deployer
      );
      const debt = await hre.ethers.getContractAt(
        'contracts/dependencies/openzeppelin/contracts/IERC20.sol:IERC20',
        params.debt,
        deployer
      );
      const collateralDetailed = await hre.ethers.getContractAt(
        'IERC20Detailed',
        params.collateral,
        deployer
      );
      const debtDetailed = await hre.ethers.getContractAt('IERC20Detailed', params.debt, deployer);

      const collateralDecimals = await collateralDetailed.decimals();
      const debtDecimals = await debtDetailed.decimals();
      const depositAmount = BigNumber.from(
        hre.ethers.utils.parseUnits(params.depositAmount, collateralDecimals)
      );
      const borrowAmount = BigNumber.from(
        hre.ethers.utils.parseUnits(params.borrowAmount, debtDecimals)
      );
      const rateMode = BigNumber.from(params.rateMode).toNumber();

      await (await collateral.approve(lendingPoolAddress, depositAmount)).wait(1);
      await (await lendingPool.deposit(params.collateral, depositAmount, signerAddress, 0)).wait(1);
      await (
        await lendingPool.borrow(params.debt, borrowAmount, rateMode, 0, signerAddress)
      ).wait(1);

      await (await debt.approve(lendingPoolAddress, borrowAmount)).wait(1);
      await (await lendingPool.repay(params.debt, borrowAmount, rateMode, signerAddress)).wait(1);
      await (
        await lendingPool.withdraw(
          params.collateral,
          hre.ethers.constants.MaxUint256,
          signerAddress
        )
      ).wait(1);
      console.log('Smoke test completed successfully');
    }

    console.log('\n[4/4] Deploying UiPoolDataProviderV2...');
    const uiPoolDataProviderFactory = await hre.ethers.getContractFactory(
      'UiPoolDataProviderV2',
      deployer
    );
    const uiPoolDataProvider = await uiPoolDataProviderFactory.deploy(
      params.priceAggregator,
      params.ethUsdAggregator
    );
    await uiPoolDataProvider.deployTransaction.wait(1);
    console.log(`UiPoolDataProviderV2 deployed at: ${uiPoolDataProvider.address}`);

    if (params.verify) {
      await hre.run('verify:verify', {
        address: uiPoolDataProvider.address,
        contract: 'contracts/misc/UiPoolDataProviderV2.sol:UiPoolDataProviderV2',
        constructorArguments: [params.priceAggregator, params.ethUsdAggregator],
      });
    }

    console.log('\nDone');
    console.log(`- AaveOracle: ${aaveOracle.address}`);
    console.log(`- UiPoolDataProviderV2: ${uiPoolDataProvider.address}`);
  });
