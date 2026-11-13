import { render, screen, fireEvent } from '@testing-library/react'; import { describe, expect, it } from 'vitest'; import { App } from '../../src/renderer/app/App';
describe('Mode B Studio navigation', () => {
  it('lands on Project Setup and navigates all screens', async () => { window.location.hash = '#/'; render(<App />); expect(await screen.findByRole('heading',{name:'Project Setup'})).toBeInTheDocument(); for (const name of ['Overview','External ChatGPT','Script','Voice & Captions','Storyboard & Images','Video Editor','Render & Export','System Settings']) { const link=screen.getByRole('link',{name:new RegExp(name)}); fireEvent.click(link); expect(await screen.findByRole('link',{name:new RegExp(name),current:'page'})).toBeInTheDocument(); } });
});
