import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ConversationsService } from './conversations.service';

function createLeanQuery<T>(value: T) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('ConversationsService chat policy', () => {
  let conversationModel: {
    findOne: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
  };
  let messageModel: Record<string, jest.Mock>;
  let conversationSettingModel: Record<string, jest.Mock>;
  let userModel: {
    find: jest.Mock;
    findById: jest.Mock;
  };
  let followRequestModel: {
    exists: jest.Mock;
  };
  let service: ConversationsService;

  beforeEach(() => {
    conversationModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    };
    messageModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      deleteOne: jest.fn(),
      countDocuments: jest.fn(),
    };
    conversationSettingModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    userModel = {
      find: jest.fn(),
      findById: jest.fn(),
    };
    followRequestModel = {
      exists: jest.fn(),
    };

    service = new ConversationsService(
      conversationModel as never,
      messageModel as never,
      conversationSettingModel as never,
      userModel as never,
      followRequestModel as never,
      { get: jest.fn() } as never,
      { emitMessageNew: jest.fn(), emitMessageDeleted: jest.fn() } as never,
      { isConfigured: jest.fn().mockReturnValue(false) } as never,
    );
  });

  it('rejects conversation creation when one user blocked the other', async () => {
    const requesterId = new Types.ObjectId().toString();
    const targetId = new Types.ObjectId().toString();

    conversationModel.findOne.mockReturnValue(createLeanQuery(null));
    userModel.find.mockReturnValue(
      createLeanQuery([
        {
          _id: new Types.ObjectId(requesterId),
          role: 'family',
          blockedUserIds: [new Types.ObjectId(targetId)],
        },
        {
          _id: new Types.ObjectId(targetId),
          role: 'family',
          blockedUserIds: [],
        },
      ]),
    );

    await expect(
      service.getOrCreateConversation(requesterId, targetId, 'family'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires accepted follow relationship for non-exempt direct chats', async () => {
    const requesterId = new Types.ObjectId().toString();
    const targetId = new Types.ObjectId().toString();

    conversationModel.findOne.mockReturnValue(createLeanQuery(null));
    userModel.find.mockReturnValue(
      createLeanQuery([
        {
          _id: new Types.ObjectId(requesterId),
          role: 'family',
          blockedUserIds: [],
        },
        {
          _id: new Types.ObjectId(targetId),
          role: 'family',
          blockedUserIds: [],
        },
      ]),
    );
    followRequestModel.exists.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.getOrCreateConversation(requesterId, targetId, 'family'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows direct chat creation without follow when one user has healthcare role', async () => {
    const requesterId = new Types.ObjectId().toString();
    const targetId = new Types.ObjectId().toString();
    const threadId = new Types.ObjectId();
    const conversationId = new Types.ObjectId();

    conversationModel.findOne.mockReturnValue(createLeanQuery(null));
    userModel.find.mockReturnValue(
      createLeanQuery([
        {
          _id: new Types.ObjectId(requesterId),
          role: 'family',
          blockedUserIds: [],
        },
        {
          _id: new Types.ObjectId(targetId),
          role: 'doctor',
          blockedUserIds: [],
        },
      ]),
    );
    userModel.findById.mockReturnValue(
      createLeanQuery({
        role: 'doctor',
        fullName: 'Dr. Sameh',
        profilePic: '',
      }),
    );
    conversationModel.create.mockResolvedValue([
      {
        _id: conversationId,
        threadId,
        name: 'Dr. Sameh',
        subtitle: '',
        lastMessage: '',
        timeAgo: '',
        imageUrl: '',
        unread: false,
        segment: 'healthcare',
      },
    ]);

    const created = await service.getOrCreateConversation(
      requesterId,
      targetId,
      'family',
    );
    expect(created.id).toBe(conversationId.toString());
    expect(created.threadId).toBe(threadId.toString());
    expect(conversationModel.create).toHaveBeenCalled();
  });

  it('rejects group creation when participants violate block policy', async () => {
    const creatorId = new Types.ObjectId().toString();
    const blockedId = new Types.ObjectId().toString();

    userModel.find.mockReturnValue(
      createLeanQuery([
        {
          _id: new Types.ObjectId(creatorId),
          role: 'family',
          blockedUserIds: [new Types.ObjectId(blockedId)],
        },
        {
          _id: new Types.ObjectId(blockedId),
          role: 'family',
          blockedUserIds: [],
        },
      ]),
    );

    await expect(
      service.createGroup(creatorId, 'Family Group', [blockedId]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(conversationModel.create).not.toHaveBeenCalled();
  });

  it('rejects adding a group member without accepted follow relationship', async () => {
    const currentUserId = new Types.ObjectId().toString();
    const candidateId = new Types.ObjectId().toString();
    const conversationId = new Types.ObjectId().toString();

    conversationModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        participants: [new Types.ObjectId(currentUserId)],
        user: new Types.ObjectId(currentUserId),
        otherUserId: null,
        save: jest.fn(),
      }),
    });
    userModel.find.mockReturnValue(
      createLeanQuery([
        {
          _id: new Types.ObjectId(currentUserId),
          role: 'family',
          blockedUserIds: [],
        },
        {
          _id: new Types.ObjectId(candidateId),
          role: 'family',
          blockedUserIds: [],
        },
      ]),
    );
    followRequestModel.exists.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.addMemberToGroup(conversationId, currentUserId, candidateId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
