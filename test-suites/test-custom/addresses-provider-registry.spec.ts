import { TestEnv, makeSuite } from './helpers/make-suite';
import { ProtocolErrors } from '../../helpers/types';
import {
  getRegistryOwnerSigner,
  stopImpersonatingRegistryOwner,
} from './helpers/mint-tokens';

const { expect } = require('chai');

makeSuite('AddressesProviderRegistry', (testEnv: TestEnv) => {
  // Track initial state for relative assertions
  let initialProviderCount: number;
  let initialProvidersList: string[];
  let addressesProviderRegisteredInitially: boolean;

  before(async () => {
    const { registry, addressesProvider } = testEnv;
    initialProvidersList = await registry.getAddressesProvidersList();
    initialProviderCount = initialProvidersList.length;

    // Check if addressesProvider is already registered
    const providerId = await registry.getAddressesProviderIdByAddress(addressesProvider.address);
    addressesProviderRegisteredInitially = !providerId.isZero();

    console.log(`Initial providers count: ${initialProviderCount}`);
    console.log(`Initial providers: ${initialProvidersList}`);
    console.log(`AddressesProvider registered: ${addressesProviderRegisteredInitially}`);

    // If not registered, register it now (for fork mode where registry might be empty)
    if (!addressesProviderRegisteredInitially) {
      console.log('Registering AddressesProvider to Registry...');
      const ownerSigner = await getRegistryOwnerSigner(registry);
      await registry.connect(ownerSigner).registerAddressesProvider(addressesProvider.address, '1');
      await stopImpersonatingRegistryOwner(registry);

      // Update initial state
      initialProvidersList = await registry.getAddressesProvidersList();
      initialProviderCount = initialProvidersList.length;
      console.log(`Updated providers count: ${initialProviderCount}`);
    }
  });

  it('Checks the addresses provider is added to the registry', async () => {
    const { addressesProvider, registry } = testEnv;

    const providers = await registry.getAddressesProvidersList();

    // Check that the addressesProvider is in the list (not necessarily at position 0)
    expect(providers.length).to.be.gte(1, 'Invalid length of the addresses providers list');
    expect(providers.map((p: string) => p.toLowerCase())).to.include(
      addressesProvider.address.toLowerCase(),
      'AddressesProvider should be in the registry'
    );
  });

  it('tries to register an addresses provider with id 0', async () => {
    const { users, registry } = testEnv;
    const { LPAPR_INVALID_ADDRESSES_PROVIDER_ID } = ProtocolErrors;

    // Registry owner is required for registerAddressesProvider
    const ownerSigner = await getRegistryOwnerSigner(registry);

    await expect(
      registry.connect(ownerSigner).registerAddressesProvider(users[2].address, '0')
    ).to.be.revertedWith(LPAPR_INVALID_ADDRESSES_PROVIDER_ID);

    await stopImpersonatingRegistryOwner(registry);
  });

  it('Registers a new mock addresses provider', async () => {
    const { users, registry } = testEnv;

    const providersBefore = await registry.getAddressesProvidersList();
    const countBefore = providersBefore.length;

    // Registry owner is required for registerAddressesProvider
    const ownerSigner = await getRegistryOwnerSigner(registry);

    // simulating an addresses provider using the users[1] wallet address
    await registry.connect(ownerSigner).registerAddressesProvider(users[1].address, '2');

    await stopImpersonatingRegistryOwner(registry);

    const providersAfter = await registry.getAddressesProvidersList();

    // Check that exactly one provider was added
    expect(providersAfter.length).to.be.equal(
      countBefore + 1,
      'Provider count should increase by 1'
    );

    // Check that the new provider is in the list
    expect(providersAfter.map((p: string) => p.toLowerCase())).to.include(
      users[1].address.toLowerCase(),
      'New provider should be in the registry'
    );
  });

  it('Removes the mock addresses provider', async () => {
    const { users, registry, addressesProvider } = testEnv;

    const id = await registry.getAddressesProviderIdByAddress(users[1].address);

    expect(id).to.be.equal('2', 'Invalid isRegistered return value');

    const providersBefore = await registry.getAddressesProvidersList();
    const countBefore = providersBefore.length;

    // Registry owner is required for unregisterAddressesProvider
    const ownerSigner = await getRegistryOwnerSigner(registry);

    await registry.connect(ownerSigner).unregisterAddressesProvider(users[1].address);

    await stopImpersonatingRegistryOwner(registry);

    const providersAfter = await registry.getAddressesProvidersList();

    // List length stays the same (entry becomes ZERO_ADDRESS)
    expect(providersAfter.length).to.be.equal(
      countBefore,
      'Provider list length should remain the same after unregister'
    );

    // The unregistered provider's slot should now be ZERO_ADDRESS
    const idAfter = await registry.getAddressesProviderIdByAddress(users[1].address);
    expect(idAfter).to.be.equal('0', 'Unregistered provider should have id 0');

    // Original addressesProvider should still be in the list
    expect(providersAfter.map((p: string) => p.toLowerCase())).to.include(
      addressesProvider.address.toLowerCase(),
      'Original AddressesProvider should still be in the registry'
    );
  });

  it('Tries to remove a unregistered addressesProvider', async () => {
    const { LPAPR_PROVIDER_NOT_REGISTERED } = ProtocolErrors;

    const { users, registry } = testEnv;

    // Registry owner is required for unregisterAddressesProvider
    const ownerSigner = await getRegistryOwnerSigner(registry);

    await expect(
      registry.connect(ownerSigner).unregisterAddressesProvider(users[2].address)
    ).to.be.revertedWith(LPAPR_PROVIDER_NOT_REGISTERED);

    await stopImpersonatingRegistryOwner(registry);
  });

  it('Tries to add an already added addressesProvider with a different id. Should overwrite the previous id', async () => {
    const { registry, addressesProvider } = testEnv;

    const providersBefore = await registry.getAddressesProvidersList();
    const countBefore = providersBefore.length;

    // Registry owner is required for registerAddressesProvider
    const ownerSigner = await getRegistryOwnerSigner(registry);

    await registry.connect(ownerSigner).registerAddressesProvider(addressesProvider.address, '2');

    await stopImpersonatingRegistryOwner(registry);

    const providersAfter = await registry.getAddressesProvidersList();

    const id = await registry.getAddressesProviderIdByAddress(addressesProvider.address);

    // List length should remain the same (re-registering existing provider)
    expect(providersAfter.length).to.be.equal(
      countBefore,
      'Provider list length should remain the same after re-register'
    );

    // ID should be updated to '2'
    expect(id).to.be.equal('2', 'Provider ID should be updated to 2');

    // addressesProvider should still be in the list
    expect(providersAfter.map((p: string) => p.toLowerCase())).to.include(
      addressesProvider.address.toLowerCase(),
      'AddressesProvider should still be in the registry'
    );
  });
});
