import type { Meta, StoryObj } from '@storybook/react-vite';
import { NewFeatureModal } from './NewFeatureModal';

const meta = {
  title: 'Components/NewFeatureModal',
  component: NewFeatureModal,
  args: { isOpen: true, onClose: () => {}, onSave: () => {} },
} satisfies Meta<typeof NewFeatureModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
