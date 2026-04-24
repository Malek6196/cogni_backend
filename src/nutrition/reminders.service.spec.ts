import { ForbiddenException } from '@nestjs/common';
import { RemindersService } from './reminders.service';

describe('RemindersService', () => {
  let taskReminderModel: {
    find: jest.Mock;
  };
  let childAccessService: {
    assertCanAccessChild: jest.Mock;
  };
  let medicationVerificationService: {
    verifyMedication: jest.Mock;
  };
  let service: RemindersService;

  beforeEach(() => {
    taskReminderModel = {
      find: jest.fn(),
    };
    childAccessService = {
      assertCanAccessChild: jest.fn(),
    };
    medicationVerificationService = {
      verifyMedication: jest.fn(),
    };
    service = new RemindersService(
      taskReminderModel as never,
      childAccessService as never,
      medicationVerificationService as never,
    );
  });

  it('blocks access before reading child reminders', async () => {
    childAccessService.assertCanAccessChild.mockRejectedValue(
      new ForbiddenException('Not authorized to access this child'),
    );

    await expect(
      service.findByChildId('child-1', 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(taskReminderModel.find).not.toHaveBeenCalled();
  });
});
