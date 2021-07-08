const anchor = require('@project-serum/anchor');
const assert = require("assert");
const TokenInstructions = require("@project-serum/serum").TokenInstructions;
const serumCommon = require("@project-serum/common");
const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey(TokenInstructions.TOKEN_PROGRAM_ID.toString());

describe("start Auction", () =>{

    const provider = anchor.Provider.local();
    anchor.setProvider(provider);
    const auctionProgram = anchor.workspace.Auction;
    const price = new anchor.BN(10);
    const nftProgram = anchor.workspace.Banksy;

    it("create a auction", async() => {
        const {auction, seller, nftHolder} = await createAuction(auctionProgram, nftProgram, price);

        const auctionAccount = await auctionProgram.account.auction.fetch(auction.publicKey);

        assert.ok(auctionAccount.ongoing);
        assert.ok(auctionAccount.noBid);
        assert.ok(auctionAccount.seller.equals(seller.publicKey));
        assert.ok(auctionAccount.bider.equals(seller.publicKey));
        assert.ok(auctionAccount.nftHolder.equals(nftHolder));
        const auctionNftHolder = await nftProgram.account.userAccount.fetch(auctionAccount.nftHolder);
        assert.ok(auctionNftHolder.amount == 10);
        assert.ok(auctionAccount.price == 10);


    });    
})

async function createAuction(program, nftProgram, price) {
  let auction = new anchor.web3.Account();
  let seller = new anchor.web3.Account();
  let [pda] = await anchor.web3.PublicKey.findProgramAddress([seller.publicKey.toBuffer()], program.programId);
  const uri = "ipfs://ipfs/QmVLAo3EQvkkQKjLTt1dawYsehSEnwYBi19vzh85pohpuw";
  const supply = new anchor.BN(100);
  let nftPublicKey = await createNftAccount(nftProgram, uri, supply, seller);
  let nftHolderPubkey = await findUserAccount(nftProgram, pda, nftPublicKey);    

  let amount = new anchor.BN(10);
  await transfer(nftProgram, nftPublicKey, seller, pda, amount);

  await program.rpc.createAuction(price, {
    accounts: {
      auction: auction.publicKey,
      seller: seller.publicKey,
      nftHolder: nftHolderPubkey,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    },
    signers: [auction],
    instructions: [await program.account.auction.createInstruction(auction)],
  });

  return {
    auction: auction,
    seller: seller,
    nftHolder: nftHolderPubkey,
  }
}

async function createTokenAccount(provider, mint, owner) {
  const vault = new anchor.web3.Account();
  const tx = new anchor.web3.Transaction();
  tx.add(...(await createTokenAccountInstrs(provider, vault.publicKey, mint, owner)));
  await provider.send(tx, [vault]);
  return vault.publicKey;
}


async function findUserAccount(program, userPublicKey, nftAccount) {
  // create a user account
  const associatedToken = await program.account.userAccount.associatedAddress(userPublicKey, nftAccount);
  const accountInfo = await program.provider.connection.getAccountInfo(associatedToken);

  if(accountInfo == null) {
    await program.rpc.createUser({
      accounts: {
        nft: nftAccount,
        payer: program.provider.wallet.publicKey,
        user: associatedToken,
        authority: userPublicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
    });
  }

  return associatedToken;
}
async function createTokenAccountWithBalance(provider, mintPubkey, owner, initBalance) {
    const tx = new anchor.web3.Transaction();
    const newAccountPubkey = new anchor.web3.Account();
    tx.add(
        ...(await createTokenAccountInstrs(provider, newAccountPubkey.publicKey, mintPubkey, owner)),
        TokenInstructions.mintTo({
            mint: mintPubkey,
            destination: newAccountPubkey.publicKey,
            amount: initBalance,
            mintAuthority: provider.wallet.publicKey,
        })
    );
    await provider.send(tx, [newAccountPubkey]);
    return newAccountPubkey.publicKey;
}

async function createTokenAccountInstrs(provider, newAccountPubkey, mint, owner, lamports) {
    if (lamports === undefined) {
      lamports = await provider.connection.getMinimumBalanceForRentExemption(165);
    }
    return [
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey,
        space: 165,
        lamports,
        programId: TOKEN_PROGRAM_ID,
      }),
      TokenInstructions.initializeAccount({
        account: newAccountPubkey,
        mint,
        owner,
      }),
    ];
  }

async function createMint(provider, feePayerPubkey) {
    const mint = new anchor.web3.Account();
    const tx = new anchor.web3.Transaction();
    const instructions = await createMintInstructions(provider, feePayerPubkey, mint.publicKey);

    tx.add(...instructions);
    await provider.send(tx, [mint]);
    return mint.publicKey;
}

async function createMintInstructions(provider, authority, mint) {
    let instructions = [
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: provider.wallet.publicKey,
        newAccountPubkey: mint,
        space: 82,
        lamports: await provider.connection.getMinimumBalanceForRentExemption(82),
        programId: TOKEN_PROGRAM_ID,
      }),
      TokenInstructions.initializeMint({
        mint,
        decimals: 0,
        mintAuthority: authority,
      }),
    ];
    return instructions;
  }

  async function createNftAccount(program, uri, supply, userKey) {
    const nftKey = anchor.web3.Keypair.generate();
    const userAccount = await program.account.userAccount.associatedAddress(userKey.publicKey, nftKey.publicKey);
    // create a nft to a account
    await program.rpc.createNft(uri, supply, {
      accounts: {
        nft: nftKey.publicKey,
        authority: userKey.publicKey,
        user: userAccount,
        payer: program.provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      },
      signers: [nftKey, userKey],
      instructions: [await program.account.nftAccount.createInstruction(nftKey, 256)],
    });

    return nftKey.publicKey;
  }

  async function transfer(program, nftAccount, user1Wallet, user2PublicKey, amount) {
    const user1Account = await findUserAccount(program, user1Wallet.publicKey, nftAccount);
    const user2Account = await findUserAccount(program, user2PublicKey, nftAccount);
    await program.rpc.transfer(amount, {
      accounts: {
        from: user1Account,
        to: user2Account,
        authority: user1Wallet.publicKey,
      },
      signers: [user1Wallet]
    });
  
  }

  function str2Bytes(str) {
    var bytes = new Array(128).fill(0);
    for (let index = 0; index < str.length; index++) {
      bytes[index] = str.charCodeAt(index);
      
    }
    return bytes;
  }
  
  function bytes2Str(bytes) {
    var str = new String();
    for (let index = 0; index < bytes.length && bytes[index] != 0; index++) {
      str += String.fromCharCode(bytes[index]);
    }
    return str;
  }
