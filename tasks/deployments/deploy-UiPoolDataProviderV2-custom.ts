import { task } from 'hardhat/config';
import { eContractid } from '../../helpers/types';
import { deployUiPoolDataProviderV2 } from '../../helpers/contracts-deployments';

task(
  `deploy-${eContractid.UiPoolDataProviderV2}-custom`,
  `Deploys UiPoolDataProviderV2 with explicit custom aggregators`
)
  .addParam('priceAggregator', 'Address for networkBaseTokenPriceInUsdProxyAggregator')
  .addParam('ethUsdAggregator', 'Address for marketReferenceCurrencyPriceInUsdProxyAggregator')
  .addFlag('verify', 'Verify UiPoolDataProviderV2 contract via Etherscan API.')
  .setAction(async ({ verify, priceAggregator, ethUsdAggregator }, localBRE) => {
    await localBRE.run('set-DRE');
    if (!localBRE.network.config.chainId) {
      throw new Error('INVALID_CHAIN_ID');
    }

    console.log(`\n- UiPoolDataProviderV2 custom deployment`);
    console.log(`\n- networkBaseTokenPriceInUsdProxyAggregator: ${priceAggregator}`);
    console.log(`\n- marketReferenceCurrencyPriceInUsdProxyAggregator: ${ethUsdAggregator}`);

    const uiPoolDataProviderV2 = await deployUiPoolDataProviderV2(
      priceAggregator,
      ethUsdAggregator,
      verify
    );

    console.log('UiPoolDataProviderV2 deployed at:', uiPoolDataProviderV2.address);
  });
