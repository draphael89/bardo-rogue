export type ContractId = 'commit' | 'cut'

interface ContractDefinition {
  id: ContractId
  destination: 'blade-path' | 'veil-path'
  family: 'blade' | 'veil'
  minosOpening: 'slam' | 'ring'
  label: string
  preview: string
}

const CONTRACTS: Readonly<Record<ContractId, ContractDefinition>> = {
  commit: {
    id: 'commit',
    destination: 'blade-path',
    family: 'blade',
    minosOpening: 'slam',
    label: 'COMMIT',
    preview: 'GUARD · KINDLY ONE · MINOS: CIRCLE',
  },
  cut: {
    id: 'cut',
    destination: 'veil-path',
    family: 'veil',
    minosOpening: 'ring',
    label: 'CUT',
    preview: 'BOLTS · HECATE · MINOS: VEIL',
  },
}

export function contractById(id: ContractId): ContractDefinition {
  return CONTRACTS[id]
}

export function isContractId(value: unknown): value is ContractId {
  return value === 'commit' || value === 'cut'
}

export function contractForDestination(destination: string): ContractDefinition | null {
  if (destination === CONTRACTS.commit.destination) return CONTRACTS.commit
  if (destination === CONTRACTS.cut.destination) return CONTRACTS.cut
  return null
}
