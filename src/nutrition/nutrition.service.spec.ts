import { ForbiddenException } from '@nestjs/common';
import { NutritionService } from './nutrition.service';

describe('NutritionService', () => {
  let nutritionPlanModel: {
    findOne: jest.Mock;
  };
  let childAccessService: {
    assertCanAccessChild: jest.Mock;
  };
  let service: NutritionService;

  beforeEach(() => {
    nutritionPlanModel = {
      findOne: jest.fn(),
    };
    childAccessService = {
      assertCanAccessChild: jest.fn(),
    };
    service = new NutritionService(
      nutritionPlanModel as never,
      childAccessService as never,
    );
  });

  it('blocks access before reading a child nutrition plan', async () => {
    childAccessService.assertCanAccessChild.mockRejectedValue(
      new ForbiddenException('Not authorized to access this child'),
    );

    await expect(
      service.findByChildId('child-1', 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(nutritionPlanModel.findOne).not.toHaveBeenCalled();
  });
});
