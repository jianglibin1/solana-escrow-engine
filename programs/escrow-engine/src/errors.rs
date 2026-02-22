use anchor_lang::prelude::*;

#[error_code]
pub enum EscrowError {
    #[msg("Escrow amount must be greater than zero")]
    InvalidAmount,
    #[msg("Escrow is not in the expected state for this operation")]
    InvalidState,
    #[msg("Only the depositor can perform this action")]
    UnauthorizedDepositor,
    #[msg("Only the arbiter can resolve disputes")]
    UnauthorizedArbiter,
    #[msg("Only a party to the escrow can raise a dispute")]
    UnauthorizedParty,
    #[msg("Auto-release slot has not been reached yet")]
    AutoReleaseNotReady,
    #[msg("Auto-release is not enabled for this escrow")]
    AutoReleaseDisabled,
    #[msg("Dispute reason is too long (max 128 characters)")]
    DisputeReasonTooLong,
    #[msg("Escrow vault balance is insufficient")]
    InsufficientVaultBalance,
}
