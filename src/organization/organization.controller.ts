import {
  Controller,
  Post,
  Delete,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
  Res,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { OrganizationService } from './organization.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { OrgScopeGuard } from './guards/org-scope.guard';
import {
  CreateStaffDto,
  CreateFamilyDto,
  UpdateStaffDto,
  UpdateFamilyDto,
  InviteUserDto,
  ReviewOrganizationDto,
  InviteOrganizationLeaderDto,
} from './dto';
import { AddChildDto } from '../children/dto/add-child.dto';
import { UpdateChildDto } from '../children/dto/update-child.dto';

@ApiTags('organization')
@ApiBearerAuth()
@Controller('organization')
@UseGuards(JwtAuthGuard, RolesGuard, OrgScopeGuard)
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  private parsePage(value: string | undefined): number {
    const n = Number.parseInt(value ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  private parseLimit(value: string | undefined): number {
    const n = Number.parseInt(value ?? '', 10);
    if (!Number.isFinite(n) || n <= 0) return 50;
    return Math.min(100, n);
  }

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private renderInvitationPreviewPage(params: {
    title: string;
    heading: string;
    description: string;
    postAction: string;
    actionLabel: string;
    secondaryLabel: string;
  }): string {
    const {
      title,
      heading,
      description,
      postAction,
      actionLabel,
      secondaryLabel,
    } = params;
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${this.escapeHtml(title)}</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f5f7fb; margin: 0; }
      .card { max-width: 560px; margin: 6vh auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; }
      h1 { margin: 0 0 12px; color: #111827; }
      p { color: #374151; line-height: 1.6; }
      .actions { display: flex; gap: 12px; margin-top: 20px; }
      button, .link { border: 0; border-radius: 8px; padding: 10px 14px; font-weight: 600; cursor: pointer; text-decoration: none; }
      button { background: #2563eb; color: #fff; }
      .link { background: #eef2ff; color: #1f2937; display: inline-block; }
      .muted { color: #6b7280; font-size: 13px; margin-top: 12px; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${this.escapeHtml(heading)}</h1>
      <p>${this.escapeHtml(description)}</p>
      <form method="post" action="${this.escapeHtml(postAction)}">
        <div class="actions">
          <button type="submit">${this.escapeHtml(actionLabel)}</button>
          <a class="link" href="javascript:window.close()">${this.escapeHtml(secondaryLabel)}</a>
        </div>
      </form>
      <p class="muted">For security, invitation links are preview-only. You must confirm with POST.</p>
    </main>
  </body>
</html>`;
  }

  private renderInvitationResultPage(params: {
    title: string;
    heading: string;
    description: string;
  }): string {
    const { title, heading, description } = params;
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${this.escapeHtml(title)}</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f5f7fb; margin: 0; }
      .card { max-width: 560px; margin: 6vh auto; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; }
      h1 { margin: 0 0 12px; color: #111827; }
      p { color: #374151; line-height: 1.6; }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>${this.escapeHtml(heading)}</h1>
      <p>${this.escapeHtml(description)}</p>
    </main>
  </body>
</html>`;
  }

  // My Organization endpoints (uses logged-in user)
  @Get('my-organization')
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Get my organization details' })
  async getMyOrganization(@Request() req: any) {
    return await this.organizationService.getMyOrganization(
      req.user.id as string,
    );
  }

  @Get('my-organization/staff')
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Get all staff in my organization' })
  async getMyStaff(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const hasExplicitPagination = page !== undefined || limit !== undefined;
    if (hasExplicitPagination) {
      return this.organizationService.getMyStaffPaginated(
        req.user.id as string,
        this.parsePage(page),
        this.parseLimit(limit),
      );
    }
    return await this.organizationService.getMyStaff(
      req.user.id as string,
      this.parsePage(page),
      this.parseLimit(limit),
    );
  }

  @Get('my-organization/families')
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Get all families in my organization' })
  async getMyFamilies(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const hasExplicitPagination = page !== undefined || limit !== undefined;
    if (hasExplicitPagination) {
      return this.organizationService.getMyFamiliesPaginated(
        req.user.id as string,
        this.parsePage(page),
        this.parseLimit(limit),
      );
    }
    return await this.organizationService.getMyFamilies(
      req.user.id as string,
      this.parsePage(page),
      this.parseLimit(limit),
    );
  }

  @Get('my-organization/children')
  @Roles(
    'organization_leader',
    'doctor',
    'volunteer',
    'careProvider',
    'psychologist',
    'speech_therapist',
    'occupational_therapist',
    'other',
  )
  @ApiOperation({ summary: 'Get all children in my organization' })
  async getMyChildren(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const hasExplicitPagination = page !== undefined || limit !== undefined;
    if (hasExplicitPagination) {
      return this.organizationService.getMyChildrenPaginated(
        req.user.id as string,
        this.parsePage(page),
        this.parseLimit(limit),
      );
    }
    return await this.organizationService.getMyChildren(
      req.user.id as string,
      this.parsePage(page),
      this.parseLimit(limit),
    );
  }

  @Get('my-organization/children-with-plans')
  @Roles(
    'organization_leader',
    'doctor',
    'volunteer',
    'careProvider',
    'psychologist',
    'speech_therapist',
    'occupational_therapist',
    'other',
  )
  @ApiOperation({
    summary: 'Get org children with plan types and needAttention for filters',
  })
  async getMyChildrenWithPlans(@Request() req: any) {
    return await this.organizationService.getMyChildrenWithPlans(
      req.user.id as string,
    );
  }

  @Get('my-organization/stats')
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Get my organization statistics' })
  async getMyStats(@Request() req: any) {
    return await this.organizationService.getMyStats(req.user.id as string);
  }

  @Post('my-organization/staff/create')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Create a new staff member in my organization' })
  async createMyStaff(
    @Request() req: any,
    @Body() createStaffDto: CreateStaffDto,
  ) {
    return await this.organizationService.createMyStaffMember(
      req.user.id as string,
      createStaffDto,
    );
  }

  @Patch('my-organization/staff/:staffId')
  @Throttle({ default: { limit: 40, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Update a staff member in my organization' })
  async updateMyStaff(
    @Request() req: any,
    @Param('staffId') staffId: string,
    @Body() updateStaffDto: UpdateStaffDto,
  ) {
    return await this.organizationService.updateMyStaff(
      req.user.id as string,
      staffId,
      updateStaffDto,
    );
  }

  @Delete('my-organization/staff/:staffId')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Remove a staff member from my organization' })
  async removeMyStaff(@Request() req: any, @Param('staffId') staffId: string) {
    return await this.organizationService.removeMyStaff(
      req.user.id as string,
      staffId,
    );
  }

  @Post('my-organization/families/create')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({
    summary:
      'Create a new family account in my organization with optional children',
  })
  async createMyFamily(
    @Request() req: any,
    @Body() createFamilyDto: CreateFamilyDto,
  ) {
    return await this.organizationService.createMyFamilyMember(
      req.user.id as string,
      createFamilyDto,
    );
  }

  @Patch('my-organization/families/:familyId')
  @Throttle({ default: { limit: 40, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Update a family member in my organization' })
  async updateMyFamily(
    @Request() req: any,
    @Param('familyId') familyId: string,
    @Body() updateFamilyDto: UpdateFamilyDto,
  ) {
    return await this.organizationService.updateMyFamily(
      req.user.id as string,
      familyId,
      updateFamilyDto,
    );
  }

  @Delete('my-organization/families/:familyId')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Remove a family from my organization' })
  async removeMyFamily(
    @Request() req: any,
    @Param('familyId') familyId: string,
  ) {
    return await this.organizationService.removeMyFamily(
      req.user.id as string,
      familyId,
    );
  }

  @Post('my-organization/families/:familyId/children')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Add a new child to a family in my organization' })
  async addChildToMyFamily(
    @Request() req: any,
    @Param('familyId') familyId: string,
    @Body() addChildDto: AddChildDto,
  ): Promise<{ fullName: string; dateOfBirth: Date; gender: string }> {
    return await this.organizationService.addChildToMyFamily(
      req.user.id as string,
      familyId,
      addChildDto,
    );
  }

  @Patch('my-organization/families/:familyId/children/:childId')
  @Throttle({ default: { limit: 40, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Update child information in my organization' })
  async updateMyChild(
    @Request() req: any,
    @Param('familyId') familyId: string,
    @Param('childId') childId: string,
    @Body() updateChildDto: UpdateChildDto,
  ): Promise<{ fullName: string; dateOfBirth: Date; gender: string }> {
    return await this.organizationService.updateMyChild(
      req.user.id as string,
      familyId,
      childId,
      updateChildDto,
    );
  }

  @Delete('my-organization/families/:familyId/children/:childId')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Delete a child from a family in my organization' })
  async deleteMyChild(
    @Request() req: any,
    @Param('familyId') familyId: string,
    @Param('childId') childId: string,
  ): Promise<{ message: string }> {
    return await this.organizationService.deleteMyChild(
      req.user.id as string,
      familyId,
      childId,
    );
  }

  // Admin: Get all families (across all organizations)
  @Get('admin/families')
  @Roles('admin')
  @ApiOperation({ summary: 'Get all family users (Admin only)' })
  async adminGetAllFamilies() {
    return await this.organizationService.adminGetAllFamilies();
  }

  // Admin: Create a new family member
  @Post('admin/families')
  @Roles('admin')
  @ApiOperation({ summary: 'Create a new family member (Admin only)' })
  async adminCreateFamily(
    @Body()
    dto: {
      fullName: string;
      email: string;
      password: string;
      phone?: string;
      organizationId?: string;
    },
  ) {
    return await this.organizationService.adminCreateFamily(dto);
  }

  // Admin: Update a family member
  @Patch('admin/families/:familyId')
  @Roles('admin')
  @ApiOperation({ summary: 'Update a family member (Admin only)' })
  async adminUpdateFamily(
    @Param('familyId') familyId: string,
    @Body() updateDto: { fullName?: string; email?: string; phone?: string },
  ) {
    return await this.organizationService.adminUpdateFamily(
      familyId,
      updateDto,
    );
  }

  // Admin: Delete a family member
  @Delete('admin/families/:familyId')
  @Roles('admin')
  @ApiOperation({
    summary: 'Delete a family member and their children (Admin only)',
  })
  async adminDeleteFamily(@Param('familyId') familyId: string) {
    return await this.organizationService.adminDeleteFamily(familyId);
  }

  // Admin: Assign family to an organization
  @Patch('admin/families/:familyId/organization')
  @Roles('admin')
  @ApiOperation({ summary: 'Assign a family to an organization (Admin only)' })
  async adminAssignFamilyToOrg(
    @Param('familyId') familyId: string,
    @Body('orgId') orgId: string,
  ) {
    return await this.organizationService.adminAssignFamilyToOrg(
      familyId,
      orgId,
    );
  }

  // Admin: Remove family from its organization
  @Delete('admin/families/:familyId/organization')
  @Roles('admin')
  @ApiOperation({
    summary: 'Remove a family from its organization (Admin only)',
  })
  async adminRemoveFamilyFromOrg(@Param('familyId') familyId: string) {
    return await this.organizationService.adminRemoveFamilyFromOrg(familyId);
  }

  // Admin: Get all children across all organizations
  @Get('admin/all-children')
  @Roles('admin')
  @ApiOperation({
    summary: 'Get all children across all organizations (Admin only)',
  })
  async adminGetAllChildren() {
    return await this.organizationService.adminGetAllChildren();
  }

  // Admin: Get children for a specific family
  @Get('admin/families/:familyId/children')
  @Roles('admin')
  @ApiOperation({ summary: "Get a family's children (Admin only)" })
  async adminGetFamilyChildren(@Param('familyId') familyId: string) {
    return await this.organizationService.adminGetFamilyChildren(familyId);
  }

  // Admin: Add a child to a family
  @Post('admin/families/:familyId/children')
  @Roles('admin')
  @ApiOperation({ summary: 'Add a child to a family (Admin only)' })
  async adminAddChildToFamily(
    @Param('familyId') familyId: string,
    @Body() addChildDto: AddChildDto,
  ) {
    return await this.organizationService.adminAddChildToFamily(
      familyId,
      addChildDto,
    );
  }

  // Admin: Update a child
  @Patch('admin/families/:familyId/children/:childId')
  @Roles('admin')
  @ApiOperation({ summary: 'Update a child (Admin only)' })
  async adminUpdateChild(
    @Param('childId') childId: string,
    @Body() updateChildDto: UpdateChildDto,
  ) {
    return await this.organizationService.adminUpdateChild(
      childId,
      updateChildDto,
    );
  }

  // Admin: Delete a child
  @Delete('admin/families/:familyId/children/:childId')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete a child (Admin only)' })
  async adminDeleteChild(
    @Param('familyId') familyId: string,
    @Param('childId') childId: string,
  ) {
    return await this.organizationService.adminDeleteChild(familyId, childId);
  }

  // Admin: Change organization leader
  @Patch(':id/change-leader')
  @Roles('admin')
  @ApiOperation({ summary: 'Change organization leader (Admin only)' })
  async changeOrganizationLeader(
    @Param('id') id: string,
    @Body('newLeaderEmail') newLeaderEmail: string,
  ) {
    return await this.organizationService.changeOrganizationLeader(
      id,
      newLeaderEmail,
    );
  }

  // Staff management endpoints
  @Post(':orgId/staff')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Add staff member to organization' })
  async addStaff(@Param('orgId') orgId: string, @Body('email') email: string) {
    return this.organizationService.addStaff(orgId, email);
  }

  @Delete(':orgId/staff/:staffId')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Remove staff member from organization' })
  async removeStaff(
    @Param('orgId') orgId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.organizationService.removeStaff(orgId, staffId);
  }

  @Get(':orgId/staff')
  @Roles('organization_leader', 'admin')
  @ApiOperation({ summary: 'Get all staff members in organization' })
  async getStaff(
    @Param('orgId') orgId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const hasExplicitPagination = page !== undefined || limit !== undefined;
    if (hasExplicitPagination) {
      return this.organizationService.getStaffPaginated(
        orgId,
        this.parsePage(page),
        this.parseLimit(limit),
      );
    }
    return this.organizationService.getStaff(
      orgId,
      this.parsePage(page),
      this.parseLimit(limit),
    );
  }

  // Family management endpoints
  @Post(':orgId/families')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Add family to organization' })
  async addFamily(@Param('orgId') orgId: string, @Body('email') email: string) {
    return await this.organizationService.addFamily(orgId, email);
  }

  @Delete(':orgId/families/:familyId')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Remove family from organization' })
  async removeFamily(
    @Param('orgId') orgId: string,
    @Param('familyId') familyId: string,
  ) {
    return await this.organizationService.removeFamily(orgId, familyId);
  }

  @Get(':orgId/families')
  @Roles('organization_leader', 'admin')
  @ApiOperation({ summary: 'Get all families in organization' })
  async getFamilies(
    @Param('orgId') orgId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const hasExplicitPagination = page !== undefined || limit !== undefined;
    if (hasExplicitPagination) {
      return this.organizationService.getFamiliesPaginated(
        orgId,
        this.parsePage(page),
        this.parseLimit(limit),
      );
    }
    return await this.organizationService.getFamilies(
      orgId,
      this.parsePage(page),
      this.parseLimit(limit),
    );
  }

  // Children management endpoints
  @Get(':orgId/children')
  @Roles('organization_leader', 'admin')
  @ApiOperation({ summary: 'Get all children in organization' })
  async getAllChildren(
    @Param('orgId') orgId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const hasExplicitPagination = page !== undefined || limit !== undefined;
    if (hasExplicitPagination) {
      return await this.organizationService.getAllChildrenPaginated(
        orgId,
        this.parsePage(page),
        this.parseLimit(limit),
      );
    }
    return await this.organizationService.getAllChildren(
      orgId,
      this.parsePage(page),
      this.parseLimit(limit),
    );
  }

  // Statistics endpoint
  @Get(':orgId/stats')
  @Roles('organization_leader', 'admin')
  @ApiOperation({ summary: 'Get organization statistics' })
  async getStats(@Param('orgId') orgId: string) {
    return await this.organizationService.getOrganizationStats(orgId);
  }

  // Create new staff member
  @Post(':orgId/staff/create')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Create a new staff member account' })
  async createStaff(
    @Param('orgId') orgId: string,
    @Body() createStaffDto: CreateStaffDto,
  ) {
    return await this.organizationService.createStaffMember(
      orgId,
      createStaffDto,
    );
  }

  // Create new family member
  @Post(':orgId/families/create')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({
    summary: 'Create a new family account with optional children',
  })
  async createFamily(
    @Param('orgId') orgId: string,
    @Body() createFamilyDto: CreateFamilyDto,
  ) {
    return await this.organizationService.createFamilyMember(
      orgId,
      createFamilyDto,
    );
  }

  // Child management endpoints
  @Post(':orgId/families/:familyId/children')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Add a new child to a family' })
  async addChildToFamily(
    @Param('orgId') orgId: string,
    @Param('familyId') familyId: string,
    @Body() addChildDto: AddChildDto,
  ): Promise<{ fullName: string; dateOfBirth: Date; gender: string }> {
    return await this.organizationService.addChildToFamily(
      orgId,
      familyId,
      addChildDto,
    );
  }

  @Patch(':orgId/families/:familyId/children/:childId')
  @Throttle({ default: { limit: 40, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Update child information' })
  async updateChild(
    @Param('orgId') orgId: string,
    @Param('familyId') familyId: string,
    @Param('childId') childId: string,
    @Body() updateChildDto: UpdateChildDto,
  ): Promise<{ fullName: string; dateOfBirth: Date; gender: string }> {
    return await this.organizationService.updateChild(
      orgId,
      familyId,
      childId,
      updateChildDto,
    );
  }

  @Delete(':orgId/families/:familyId/children/:childId')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Delete a child from a family' })
  async deleteChild(
    @Param('orgId') orgId: string,
    @Param('familyId') familyId: string,
    @Param('childId') childId: string,
  ): Promise<{ message: string }> {
    return await this.organizationService.deleteChild(orgId, familyId, childId);
  }

  // Invitation endpoints
  @Post('my-organization/staff/invite')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({
    summary: 'Invite a new or existing user to join as staff',
  })
  async inviteStaff(
    @Request() req: any,
    @Body() inviteUserDto: InviteUserDto,
  ): Promise<{ message: string }> {
    return await this.organizationService.inviteMyUser(
      req.user.id as string,
      inviteUserDto.email,
      'staff',
      {
        fullName: inviteUserDto.fullName as string,
        phone: inviteUserDto.phone,
        role: inviteUserDto.role,
      },
    );
  }

  @Post('my-organization/families/invite')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({
    summary: 'Invite an existing user to join as family (pending approval)',
  })
  async inviteFamily(
    @Request() req: any,
    @Body() inviteUserDto: InviteUserDto,
  ): Promise<{ message: string }> {
    return await this.organizationService.inviteMyUser(
      req.user.id as string,
      inviteUserDto.email,
      'family',
    );
  }

  @Get('my-organization/invitations')
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Get all pending invitations for my organization' })
  async getMyInvitations(@Request() req: any) {
    return await this.organizationService.getMyPendingInvitations(
      req.user.id as string,
    );
  }

  @Delete('my-organization/invitations/:id')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Cancel a pending invitation' })
  async cancelInvitation(@Request() req: any, @Param('id') id: string) {
    return await this.organizationService.cancelInvitation(
      id,
      req.user.id as string,
    );
  }

  @Get('invitations/:token/accept')
  @Public()
  @ApiOperation({ summary: 'Preview organization invitation acceptance' })
  async previewAcceptInvitation(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const preview =
        await this.organizationService.getInvitationPreview(token);
      const orgName = preview.organizationName ?? 'your organization';
      return res.send(
        this.renderInvitationPreviewPage({
          title: 'Invitation preview',
          heading: 'Confirm invitation acceptance',
          description: `You are about to join ${orgName} as ${preview.invitationType}.`,
          postAction: '',
          actionLabel: 'Accept invitation',
          secondaryLabel: 'Close',
        }),
      );
    } catch (error) {
      return res.status(400).send(
        this.renderInvitationResultPage({
          title: 'Invitation error',
          heading: 'Invitation cannot be processed',
          description:
            error instanceof Error
              ? error.message
              : 'Unable to preview invitation.',
        }),
      );
    }
  }

  @Post('invitations/:token/accept')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Public()
  @ApiOperation({ summary: 'Confirm organization invitation acceptance' })
  async confirmAcceptInvitation(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const result =
        await this.organizationService.confirmInvitationAcceptance(token);
      return res.send(
        this.renderInvitationResultPage({
          title: 'Invitation accepted',
          heading: 'Invitation accepted',
          description: `You joined ${result.organizationName}. You can now sign in to CogniCare.`,
        }),
      );
    } catch (error) {
      return res.status(400).send(
        this.renderInvitationResultPage({
          title: 'Invitation error',
          heading: 'Invitation acceptance failed',
          description:
            error instanceof Error
              ? error.message
              : 'Unable to process invitation.',
        }),
      );
    }
  }

  @Get('invitations/:token/reject')
  @Public()
  @ApiOperation({ summary: 'Preview organization invitation rejection' })
  async previewRejectInvitation(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const preview =
        await this.organizationService.getInvitationPreview(token);
      const orgName = preview.organizationName ?? 'this organization';
      return res.send(
        this.renderInvitationPreviewPage({
          title: 'Invitation preview',
          heading: 'Confirm invitation rejection',
          description: `You are about to decline the invitation from ${orgName}.`,
          postAction: '',
          actionLabel: 'Decline invitation',
          secondaryLabel: 'Keep pending',
        }),
      );
    } catch (error) {
      return res.status(400).send(
        this.renderInvitationResultPage({
          title: 'Invitation error',
          heading: 'Invitation cannot be processed',
          description:
            error instanceof Error
              ? error.message
              : 'Unable to preview invitation.',
        }),
      );
    }
  }

  @Post('invitations/:token/reject')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Public()
  @ApiOperation({ summary: 'Confirm organization invitation rejection' })
  async confirmRejectInvitation(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      await this.organizationService.confirmInvitationRejection(token);
      return res.send(
        this.renderInvitationResultPage({
          title: 'Invitation declined',
          heading: 'Invitation declined',
          description: 'The invitation was declined successfully.',
        }),
      );
    } catch (error) {
      return res.status(400).send(
        this.renderInvitationResultPage({
          title: 'Invitation error',
          heading: 'Invitation rejection failed',
          description:
            error instanceof Error
              ? error.message
              : 'Unable to process invitation.',
        }),
      );
    }
  }

  // Admin endpoints for pending organizations
  @Get('admin/pending-requests')
  @Roles('admin')
  @ApiOperation({
    summary: 'Get all pending organization requests (Admin only)',
  })
  async getPendingOrganizationRequests() {
    return await this.organizationService.getAllPendingOrganizations();
  }

  @Get('admin/reviewed-requests')
  @Roles('admin')
  @ApiOperation({
    summary: 'Get reviewed organization requests (Admin only)',
  })
  async getReviewedOrganizationRequests() {
    return await this.organizationService.getReviewedOrganizations();
  }

  @Post('admin/review/:requestId')
  @Roles('admin')
  @ApiOperation({ summary: 'Review pending organization request (Admin only)' })
  async reviewOrganizationRequest(
    @Param('requestId') requestId: string,
    @Body() reviewDto: ReviewOrganizationDto,
    @Request() req: any,
  ) {
    return await this.organizationService.reviewOrganization(
      requestId,
      req.user.id as string,
      reviewDto.decision,
      reviewDto.rejectionReason,
    );
  }

  @Post('admin/re-review/:requestId')
  @Roles('admin')
  @ApiOperation({
    summary: 'Re-review previously reviewed organization request (Admin only)',
  })
  async reReviewOrganizationRequest(
    @Param('requestId') requestId: string,
    @Body() reviewDto: ReviewOrganizationDto,
    @Request() req: any,
  ) {
    return await this.organizationService.reReviewOrganization(
      requestId,
      req.user.id as string,
      reviewDto.decision,
      reviewDto.rejectionReason,
    );
  }

  // Admin: Invite organization leader
  @Post('admin/invite-leader')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Roles('admin')
  @ApiOperation({ summary: 'Invite a new organization leader (Admin only)' })
  async inviteOrganizationLeader(
    @Body() inviteDto: InviteOrganizationLeaderDto,
  ) {
    return await this.organizationService.inviteOrganizationLeader(
      inviteDto.organizationName,
      inviteDto.leaderFullName,
      inviteDto.leaderEmail,
      inviteDto.leaderPhone,
      inviteDto.leaderPassword,
    );
  }

  // Admin: Get pending org leader invitations
  @Get('admin/pending-invitations')
  @Roles('admin')
  @ApiOperation({
    summary: 'Get pending organization leader invitations (Admin only)',
  })
  async getPendingOrgLeaderInvitations() {
    return await this.organizationService.getPendingOrgLeaderInvitations();
  }

  // Admin: Cancel org leader invitation
  @Delete('admin/invitations/:invitationId')
  @Roles('admin')
  @ApiOperation({
    summary: 'Cancel organization leader invitation (Admin only)',
  })
  async cancelOrgLeaderInvitation(@Param('invitationId') invitationId: string) {
    await this.organizationService.cancelOrgLeaderInvitation(invitationId);
    return { message: 'Invitation cancelled successfully' };
  }

  // Admin: Get all organizations
  @Get('all')
  @Roles('admin')
  @ApiOperation({ summary: 'Get all organizations (Admin only)' })
  async getAllOrganizations() {
    return await this.organizationService.getAllOrganizations();
  }

  // Admin: Delete organization
  @Delete(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Delete an organization (Admin only)' })
  async deleteOrganization(@Param('id') id: string) {
    await this.organizationService.deleteOrganization(id);
    return { message: 'Organization deleted successfully' };
  }

  // Admin: Update organization
  @Patch(':id')
  @Roles('admin')
  @ApiOperation({ summary: 'Update an organization (Admin only)' })
  async updateOrganization(
    @Param('id') id: string,
    @Body() updateDto: { organizationName?: string },
  ) {
    return await this.organizationService.updateOrganization(id, updateDto);
  }

  @Public()
  @Get('admin/invitations/:token/accept')
  @ApiOperation({
    summary: 'Preview organization leader invitation acceptance',
  })
  async previewAcceptOrgLeaderInvitation(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const preview =
        await this.organizationService.getOrgLeaderInvitationPreview(token);
      return res.send(
        this.renderInvitationPreviewPage({
          title: 'Organization leader invite',
          heading: 'Confirm organization leader invitation',
          description: `You are about to activate leadership for ${preview.organizationName}.`,
          postAction: '',
          actionLabel: 'Accept invitation',
          secondaryLabel: 'Close',
        }),
      );
    } catch (error) {
      return res.status(400).send(
        this.renderInvitationResultPage({
          title: 'Invitation error',
          heading: 'Invitation cannot be processed',
          description:
            error instanceof Error
              ? error.message
              : 'Unable to preview invitation.',
        }),
      );
    }
  }

  @Public()
  @Post('admin/invitations/:token/accept')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Confirm organization leader invitation acceptance',
  })
  async confirmAcceptOrgLeaderInvitation(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const result =
        await this.organizationService.confirmOrgLeaderInvitationAcceptance(
          token,
        );
      return res.send(
        this.renderInvitationResultPage({
          title: 'Invitation accepted',
          heading: 'Organization leader invitation accepted',
          description: `Organization ${result.organization.name} was created successfully.`,
        }),
      );
    } catch (error) {
      return res.status(400).send(
        this.renderInvitationResultPage({
          title: 'Invitation error',
          heading: 'Invitation acceptance failed',
          description:
            error instanceof Error
              ? error.message
              : 'Unable to process invitation.',
        }),
      );
    }
  }

  @Public()
  @Get('admin/invitations/:token/reject')
  @ApiOperation({ summary: 'Preview organization leader invitation rejection' })
  async previewRejectOrgLeaderInvitation(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      const preview =
        await this.organizationService.getOrgLeaderInvitationPreview(token);
      return res.send(
        this.renderInvitationPreviewPage({
          title: 'Organization leader invite',
          heading: 'Confirm invitation rejection',
          description: `You are about to decline leadership for ${preview.organizationName}.`,
          postAction: '',
          actionLabel: 'Decline invitation',
          secondaryLabel: 'Keep pending',
        }),
      );
    } catch (error) {
      return res.status(400).send(
        this.renderInvitationResultPage({
          title: 'Invitation error',
          heading: 'Invitation cannot be processed',
          description:
            error instanceof Error
              ? error.message
              : 'Unable to preview invitation.',
        }),
      );
    }
  }

  @Public()
  @Post('admin/invitations/:token/reject')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Confirm organization leader invitation rejection' })
  async confirmRejectOrgLeaderInvitation(
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    try {
      await this.organizationService.confirmOrgLeaderInvitationRejection(token);
      return res.send(
        this.renderInvitationResultPage({
          title: 'Invitation declined',
          heading: 'Organization leader invitation declined',
          description: 'The invitation was declined successfully.',
        }),
      );
    } catch (error) {
      return res.status(400).send(
        this.renderInvitationResultPage({
          title: 'Invitation error',
          heading: 'Invitation rejection failed',
          description:
            error instanceof Error
              ? error.message
              : 'Unable to process invitation.',
        }),
      );
    }
  }

  // User endpoint to check pending organization status
  @Get('my-pending-request')
  @Roles('organization_leader')
  @ApiOperation({ summary: 'Get my pending organization request status' })
  async getMyPendingRequest(@Request() req: any) {
    return await this.organizationService.getUserPendingOrganization(
      req.user.id as string,
    );
  }
}
