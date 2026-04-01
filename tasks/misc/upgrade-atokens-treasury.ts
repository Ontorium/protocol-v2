import { task } from 'hardhat/config';
import { eNetwork, ICommonConfiguration } from '../../helpers/types';
import {
  getAaveProtocolDataProvider,
  getLendingPoolAddressesProvider,
  getLendingPoolConfiguratorProxy,
} from '../../helpers/contracts-getters';
import { getParamPerNetwork } from '../../helpers/contracts-helpers';
import { loadPoolConfig, ConfigNames, getTreasuryAddress } from '../../helpers/configuration';
import { waitForTx, notFalsyOrZeroAddress } from '../../helpers/misc-utils';
import { ZERO_ADDRESS } from '../../helpers/constants';
import { getFirstSigner } from '../../helpers/contracts-getters';

task('upgrade-atokens-treasury', 'Upgrade aTokens to V2 with new treasury address')
  .addParam('pool', `Pool name: ${Object.values(ConfigNames)}`)
  .addOptionalParam('treasury', 'New treasury address (optional, uses config if not provided)')
  .setAction(async ({ pool, treasury }, hre) => {
    await hre.run('set-DRE');
    const network = hre.network.name as eNetwork;
    const poolConfig = loadPoolConfig(pool);

    const { ATokenNamePrefix, SymbolPrefix, ReserveAssets, IncentivesController } =
      poolConfig as ICommonConfiguration;

    // Get treasury address from config or parameter
    const treasuryAddress = treasury || (await getTreasuryAddress(poolConfig));
    if (!notFalsyOrZeroAddress(treasuryAddress)) {
      throw new Error('Treasury address is not set. Provide --treasury parameter or set in config');
    }

    console.log('\n=== Upgrading aTokens with new treasury ===');
    console.log('Network:', network);
    console.log('Treasury address:', treasuryAddress);

    const addressesProvider = await getLendingPoolAddressesProvider();
    const configurator = await getLendingPoolConfiguratorProxy();
    const dataProvider = await getAaveProtocolDataProvider();

    const reserveAssets = await getParamPerNetwork(ReserveAssets, network);
    const incentivesController = await getParamPerNetwork(IncentivesController, network);

    if (!reserveAssets) {
      throw new Error('Reserve assets not configured for this network');
    }

    // Deploy new ATokenV2 implementation
    console.log('\n1. Deploying ATokenV2 implementation...');
    const signer = await getFirstSigner();
    const ATokenV2Factory = await hre.ethers.getContractFactory('ATokenV2', signer);
    const aTokenV2Impl = await ATokenV2Factory.deploy();
    await aTokenV2Impl.deployed();
    console.log('   ATokenV2 implementation deployed at:', aTokenV2Impl.address);

    // Upgrade each reserve's aToken
    console.log('\n2. Upgrading aTokens...');
    for (const [symbol, tokenAddress] of Object.entries(reserveAssets)) {
      if (!tokenAddress || tokenAddress === ZERO_ADDRESS) {
        console.log(`   Skipping ${symbol} - no token address`);
        continue;
      }

      try {
        // Get reserve data
        const reserveData = await dataProvider.getReserveTokensAddresses(tokenAddress);
        const aTokenAddress = reserveData.aTokenAddress;

        // Get current aToken info
        const aToken = await hre.ethers.getContractAt('AToken', aTokenAddress);
        const currentTreasury = await aToken.RESERVE_TREASURY_ADDRESS();
        const decimals = await aToken.decimals();
        const name = await aToken.name();
        const tokenSymbol = await aToken.symbol();

        console.log(`\n   ${symbol}:`);
        console.log(`   - aToken: ${aTokenAddress}`);
        console.log(`   - Current treasury: ${currentTreasury}`);
        console.log(`   - Name: ${name}, Symbol: ${tokenSymbol}`);

        if (currentTreasury.toLowerCase() === treasuryAddress.toLowerCase()) {
          console.log(`   - Treasury already set correctly, skipping`);
          continue;
        }

        // Prepare update input
        const updateInput = {
          asset: tokenAddress,
          treasury: treasuryAddress,
          incentivesController: incentivesController || ZERO_ADDRESS,
          name: name,
          symbol: tokenSymbol,
          implementation: aTokenV2Impl.address,
          params: '0x',
        };

        console.log(`   - Upgrading to new implementation with treasury: ${treasuryAddress}`);
        await waitForTx(await configurator.updateAToken(updateInput));

        // Verify new treasury
        const newTreasury = await aToken.RESERVE_TREASURY_ADDRESS();
        console.log(`   - New treasury: ${newTreasury}`);

        if (newTreasury.toLowerCase() === treasuryAddress.toLowerCase()) {
          console.log(`   - SUCCESS: Treasury updated!`);
        } else {
          console.log(`   - WARNING: Treasury may not have updated correctly`);
        }
      } catch (error) {
        console.error(`   Error upgrading ${symbol}:`, error);
      }
    }

    console.log('\n=== Upgrade complete ===\n');
  });
