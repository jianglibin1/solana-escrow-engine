import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";

describe("escrow-engine", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.EscrowEngine as Program;

  // Keypairs
  const depositor = anchor.web3.Keypair.generate();
  const beneficiary = anchor.web3.Keypair.generate();
  const arbiter = anchor.web3.Keypair.generate();

  let mint: anchor.web3.PublicKey;
  let depositorToken: anchor.web3.PublicKey;
  let beneficiaryToken: anchor.web3.PublicKey;
  let escrowPda: anchor.web3.PublicKey;
  let vaultPda: anchor.web3.PublicKey;
  let vaultAuthorityPda: anchor.web3.PublicKey;

  const escrowId = new anchor.BN(1);
  const escrowAmount = new anchor.BN(1_000_000); // 1M tokens

  before(async () => {
    // Airdrop SOL to depositor and arbiter
    const airdropSig1 = await provider.connection.requestAirdrop(
      depositor.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig1);

    const airdropSig2 = await provider.connection.requestAirdrop(
      arbiter.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig2);

    const airdropSig3 = await provider.connection.requestAirdrop(
      beneficiary.publicKey,
      1 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig3);

    // Create SPL token mint
    mint = await createMint(
      provider.connection,
      depositor,
      depositor.publicKey,
      null,
      6
    );

    // Create token accounts
    depositorToken = await createAccount(
      provider.connection,
      depositor,
      mint,
      depositor.publicKey
    );

    beneficiaryToken = await createAccount(
      provider.connection,
      beneficiary,
      mint,
      beneficiary.publicKey
    );

    // Mint tokens to depositor
    await mintTo(
      provider.connection,
      depositor,
      mint,
      depositorToken,
      depositor,
      2_000_000
    );

    // Derive PDAs
    [escrowPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        depositor.publicKey.toBuffer(),
        escrowId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    [vaultPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPda.toBuffer()],
      program.programId
    );

    [vaultAuthorityPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority"), escrowPda.toBuffer()],
      program.programId
    );
  });

  it("Initializes an escrow", async () => {
    const tx = await program.methods
      .initializeEscrow(escrowId, escrowAmount, null)
      .accounts({
        depositor: depositor.publicKey,
        beneficiary: beneficiary.publicKey,
        arbiter: arbiter.publicKey,
        mint: mint,
        escrow: escrowPda,
        vault: vaultPda,
        vaultAuthority: vaultAuthorityPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([depositor])
      .rpc();

    console.log("  Initialize tx:", tx);

    const escrowAccount = await program.account.escrowAccount.fetch(escrowPda);
    assert.ok(escrowAccount.depositor.equals(depositor.publicKey));
    assert.ok(escrowAccount.beneficiary.equals(beneficiary.publicKey));
    assert.ok(escrowAccount.arbiter.equals(arbiter.publicKey));
    assert.equal(escrowAccount.amount.toNumber(), 1_000_000);
    assert.deepEqual(escrowAccount.status, { created: {} });
  });

  it("Funds the escrow", async () => {
    const tx = await program.methods
      .fundEscrow()
      .accounts({
        depositor: depositor.publicKey,
        escrow: escrowPda,
        depositorToken: depositorToken,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([depositor])
      .rpc();

    console.log("  Fund tx:", tx);

    const escrowAccount = await program.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrowAccount.status, { funded: {} });

    const vaultAccount = await getAccount(provider.connection, vaultPda);
    assert.equal(Number(vaultAccount.amount), 1_000_000);
  });

  it("Releases funds to beneficiary", async () => {
    const tx = await program.methods
      .releaseFunds()
      .accounts({
        depositor: depositor.publicKey,
        escrow: escrowPda,
        vault: vaultPda,
        vaultAuthority: vaultAuthorityPda,
        beneficiaryToken: beneficiaryToken,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([depositor])
      .rpc();

    console.log("  Release tx:", tx);

    const escrowAccount = await program.account.escrowAccount.fetch(escrowPda);
    assert.deepEqual(escrowAccount.status, { released: {} });

    const beneficiaryAccount = await getAccount(
      provider.connection,
      beneficiaryToken
    );
    assert.equal(Number(beneficiaryAccount.amount), 1_000_000);
  });

  // --- Dispute flow test with a second escrow ---
  const escrowId2 = new anchor.BN(2);
  let escrowPda2: anchor.web3.PublicKey;
  let vaultPda2: anchor.web3.PublicKey;
  let vaultAuthorityPda2: anchor.web3.PublicKey;

  it("Initializes and funds a second escrow for dispute test", async () => {
    [escrowPda2] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        depositor.publicKey.toBuffer(),
        escrowId2.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    [vaultPda2] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPda2.toBuffer()],
      program.programId
    );

    [vaultAuthorityPda2] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority"), escrowPda2.toBuffer()],
      program.programId
    );

    await program.methods
      .initializeEscrow(escrowId2, escrowAmount, null)
      .accounts({
        depositor: depositor.publicKey,
        beneficiary: beneficiary.publicKey,
        arbiter: arbiter.publicKey,
        mint: mint,
        escrow: escrowPda2,
        vault: vaultPda2,
        vaultAuthority: vaultAuthorityPda2,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([depositor])
      .rpc();

    await program.methods
      .fundEscrow()
      .accounts({
        depositor: depositor.publicKey,
        escrow: escrowPda2,
        depositorToken: depositorToken,
        vault: vaultPda2,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([depositor])
      .rpc();
  });

  it("Raises a dispute", async () => {
    const tx = await program.methods
      .raiseDispute("Service not delivered as agreed")
      .accounts({
        party: depositor.publicKey,
        escrow: escrowPda2,
      })
      .signers([depositor])
      .rpc();

    console.log("  Dispute tx:", tx);

    const escrowAccount = await program.account.escrowAccount.fetch(escrowPda2);
    assert.deepEqual(escrowAccount.status, { disputed: {} });
    assert.equal(escrowAccount.disputeReason, "Service not delivered as agreed");
  });

  it("Arbiter resolves dispute in favor of depositor", async () => {
    // Create a fresh depositor token account to receive refund
    const depositorToken2 = await createAccount(
      provider.connection,
      depositor,
      mint,
      depositor.publicKey
    );

    const tx = await program.methods
      .resolveDispute(false)
      .accounts({
        arbiter: arbiter.publicKey,
        escrow: escrowPda2,
        vault: vaultPda2,
        vaultAuthority: vaultAuthorityPda2,
        beneficiaryToken: beneficiaryToken,
        depositorToken: depositorToken2,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([arbiter])
      .rpc();

    console.log("  Resolve tx:", tx);

    const escrowAccount = await program.account.escrowAccount.fetch(escrowPda2);
    assert.deepEqual(escrowAccount.status, { cancelled: {} });

    const depositorAccount = await getAccount(
      provider.connection,
      depositorToken2
    );
    assert.equal(Number(depositorAccount.amount), 1_000_000);
  });

  // --- Cancel flow test ---
  const escrowId3 = new anchor.BN(3);
  let escrowPda3: anchor.web3.PublicKey;
  let vaultPda3: anchor.web3.PublicKey;
  let vaultAuthorityPda3: anchor.web3.PublicKey;

  it("Cancels an unfunded escrow", async () => {
    [escrowPda3] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        depositor.publicKey.toBuffer(),
        escrowId3.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    [vaultPda3] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPda3.toBuffer()],
      program.programId
    );

    [vaultAuthorityPda3] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority"), escrowPda3.toBuffer()],
      program.programId
    );

    await program.methods
      .initializeEscrow(escrowId3, escrowAmount, null)
      .accounts({
        depositor: depositor.publicKey,
        beneficiary: beneficiary.publicKey,
        arbiter: arbiter.publicKey,
        mint: mint,
        escrow: escrowPda3,
        vault: vaultPda3,
        vaultAuthority: vaultAuthorityPda3,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([depositor])
      .rpc();

    const tx = await program.methods
      .cancelEscrow()
      .accounts({
        depositor: depositor.publicKey,
        escrow: escrowPda3,
        vault: vaultPda3,
        vaultAuthority: vaultAuthorityPda3,
        depositorToken: depositorToken,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([depositor])
      .rpc();

    console.log("  Cancel tx:", tx);

    const escrowAccount = await program.account.escrowAccount.fetch(escrowPda3);
    assert.deepEqual(escrowAccount.status, { cancelled: {} });
  });
});
