use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct EscrowAccount {
    /// Unique escrow identifier (set by the depositor).
    pub escrow_id: u64,
    /// The party depositing funds.
    pub depositor: Pubkey,
    /// The party receiving funds on successful completion.
    pub beneficiary: Pubkey,
    /// Optional arbiter for dispute resolution.
    pub arbiter: Pubkey,
    /// SPL token mint for the escrowed asset.
    pub mint: Pubkey,
    /// The escrow vault token account (PDA-owned).
    pub vault: Pubkey,
    /// Amount expected to be deposited.
    pub amount: u64,
    /// Current state of the escrow.
    pub status: EscrowStatus,
    /// Slot after which auto-release is allowed (0 = disabled).
    pub auto_release_slot: u64,
    /// Slot when the escrow was created.
    pub created_at_slot: u64,
    /// Slot when the escrow was last updated.
    pub updated_at_slot: u64,
    /// Dispute reason (truncated to 128 chars).
    #[max_len(128)]
    pub dispute_reason: String,
    /// Bump seed for the escrow PDA.
    pub bump: u8,
    /// Bump seed for the vault authority PDA.
    pub vault_authority_bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EscrowStatus {
    /// Escrow created, awaiting funding.
    Created,
    /// Funds deposited, awaiting release or dispute.
    Funded,
    /// Dispute raised, awaiting arbiter resolution.
    Disputed,
    /// Funds released to beneficiary.
    Released,
    /// Funds returned to depositor (cancelled or dispute lost).
    Cancelled,
}

impl Default for EscrowStatus {
    fn default() -> Self {
        EscrowStatus::Created
    }
}

impl std::fmt::Display for EscrowStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EscrowStatus::Created => write!(f, "Created"),
            EscrowStatus::Funded => write!(f, "Funded"),
            EscrowStatus::Disputed => write!(f, "Disputed"),
            EscrowStatus::Released => write!(f, "Released"),
            EscrowStatus::Cancelled => write!(f, "Cancelled"),
        }
    }
}
