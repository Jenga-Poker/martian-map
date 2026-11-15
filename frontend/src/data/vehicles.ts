export type Vehicle = {
  id: string;
  name: string;
  image: string;
};

export const VEHICLES: Vehicle[] = [
  { id: 'perseverance', name: 'Perseverance', image: '/rovers/perseverance.jpg' },
  { id: 'curiosity', name: 'Curiosity', image: '/rovers/curiosity.jpg' },
  { id: 'opportunity', name: 'Opportunity', image: '/rovers/opportunity.jpg' },
  { id: 'spirit', name: 'Spirit', image: '/rovers/spirit.jpg' },
  { id: 'sojourner', name: 'Sojourner', image: '/rovers/sojourner.jpg' },
];
