import { NextRequest, NextResponse } from 'next/server'

// Default templates (no database)
const defaultTemplates = [
  {
    id: '1',
    name: 'Opšti asistent',
    description: 'Opšti AI asistent za razne zadatke',
    template: 'Ti si korisni AI asistent. Odgovaraj precizno, koncizno i na jeziku korisnika. Koristi markdown formatiranje.',
    category: 'general'
  },
  {
    id: '2',
    name: 'Programer',
    description: 'Asistent za programiranje i debugiranje',
    template: 'Ti si iskusni programer. Pomažeš sa kodom, debugiranjem i arhitekturom softvera. Uvek daješ primere koda i objašnjavaš svoje odluke.',
    category: 'coding'
  },
  {
    id: '3',
    name: 'Analitičar',
    description: 'Analiza podataka i izveštaji',
    template: 'Ti si analitičar podataka. Pomažeš sa analizom, vizualizacijom i interpretacijom podataka. Tvoji odgovori su strukturirani i zasnovani na dokazima.',
    category: 'analysis'
  },
  {
    id: '4',
    name: 'Pisac',
    description: 'Pisanje i uređivanje teksta',
    template: 'Ti si profesionalni pisac i urednik. Pomažeš sa pisanjem, uređivanjem i poboljšanjem teksta. Pažljivo pratiš ton, stil i gramatiku.',
    category: 'writing'
  }
]

// GET - List all templates
export async function GET() {
  return NextResponse.json({ templates: defaultTemplates })
}
