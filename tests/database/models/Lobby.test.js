const Lobby = require('../../../src/database/models/Lobby');

describe('Lobby Model', () => {
  describe('constructor', () => {
    it('should create a lobby with provided data', () => {
      const data = {
        id: 'test-lobby-1',
        guild_id: 'guild-123',
        leader_id: 'user-456',
        game_type: 'Valorant',
        status: 'active'
      };

      const lobby = new Lobby(data);

      expect(lobby.id).toBe('test-lobby-1');
      expect(lobby.guildId).toBe('guild-123');
      expect(lobby.leaderId).toBe('user-456');
      expect(lobby.gameType).toBe('Valorant');
      expect(lobby.status).toBe('active');
    });

    it('should handle both snake_case and camelCase properties', () => {
      const lobby1 = new Lobby({ guild_id: 'guild-123' });
      const lobby2 = new Lobby({ guildId: 'guild-123' });

      expect(lobby1.guildId).toBe('guild-123');
      expect(lobby2.guildId).toBe('guild-123');
    });
  });

  describe('create', () => {
    it('should create a new lobby with generated ID', () => {
      const lobby = Lobby.create('guild-123', 'user-456', 'Valorant', 60);

      expect(lobby.id).toMatch(/^lobby_\d+_[a-z0-9]+$/);
      expect(lobby.guildId).toBe('guild-123');
      expect(lobby.leaderId).toBe('user-456');
      expect(lobby.gameType).toBe('Valorant');
      expect(lobby.status).toBe('active');
      expect(lobby.hasMember('user-456')).toBe(true);
    });

    it('should set correct expiration time', () => {
      const lobby = Lobby.create('guild-123', 'user-456', 'Valorant', 30);
      const expiryTime = new Date(lobby.expiresAt);
      const expectedTime = new Date(Date.now() + (30 * 60 * 1000));
      
      // Allow 1 second tolerance for test execution time
      expect(Math.abs(expiryTime.getTime() - expectedTime.getTime())).toBeLessThan(1000);
    });
  });

  describe('validate', () => {
    it('should validate a correct lobby', () => {
      const lobby = Lobby.create('guild-123', 'user-456', 'Valorant');
      const validation = lobby.validate();

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should reject lobby without required fields', () => {
      const lobby = new Lobby({});
      const validation = lobby.validate();

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Lobby ID is required');
      expect(validation.errors).toContain('Guild ID is required');
      expect(validation.errors).toContain('Leader ID is required');
      expect(validation.errors).toContain('Game type is required');
    });

    it('should reject lobby with invalid status', () => {
      const lobby = new Lobby({
        id: 'test',
        guildId: 'guild-123',
        leaderId: 'user-456',
        gameType: 'Valorant',
        status: 'invalid-status'
      });

      const validation = lobby.validate();
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Invalid lobby status');
    });
  });

  describe('member management', () => {
    let lobby;

    beforeEach(() => {
      lobby = Lobby.create('guild-123', 'leader-456', 'Valorant');
    });

    it('should add and remove members', () => {
      expect(lobby.addMember('user-789')).toBe(true);
      expect(lobby.hasMember('user-789')).toBe(true);
      expect(lobby.getMemberCount()).toBe(2); // leader + new member

      expect(lobby.removeMember('user-789')).toBe(true);
      expect(lobby.hasMember('user-789')).toBe(false);
      expect(lobby.getMemberCount()).toBe(1);
    });

    it('should not add members to inactive lobby', () => {
      lobby.disband();
      expect(lobby.addMember('user-789')).toBe(false);
    });

    it('should identify leader correctly', () => {
      expect(lobby.isLeader('leader-456')).toBe(true);
      expect(lobby.isLeader('user-789')).toBe(false);
    });

    it('should transfer leadership', () => {
      lobby.addMember('user-789');
      expect(lobby.transferLeadership('user-789')).toBe(true);
      expect(lobby.isLeader('user-789')).toBe(true);
      expect(lobby.isLeader('leader-456')).toBe(false);
    });

    it('should not transfer leadership to non-member', () => {
      expect(lobby.transferLeadership('non-member')).toBe(false);
      expect(lobby.isLeader('leader-456')).toBe(true);
    });
  });

  describe('status management', () => {
    let lobby;

    beforeEach(() => {
      lobby = Lobby.create('guild-123', 'leader-456', 'Valorant', 60);
    });

    it('should be active when created', () => {
      expect(lobby.isActive()).toBe(true);
      expect(lobby.isExpired()).toBe(false);
    });

    it('should be inactive when disbanded', () => {
      lobby.disband();
      expect(lobby.isActive()).toBe(false);
      expect(lobby.status).toBe('disbanded');
    });

    it('should be inactive when expired', () => {
      lobby.expire();
      expect(lobby.isActive()).toBe(false);
      expect(lobby.status).toBe('expired');
    });

    it('should detect expiration by time', () => {
      // Create lobby that expires in the past
      lobby.expiresAt = new Date(Date.now() - 1000).toISOString();
      expect(lobby.isExpired()).toBe(true);
      expect(lobby.isActive()).toBe(false);
    });
  });

  describe('time management', () => {
    let lobby;

    beforeEach(() => {
      lobby = Lobby.create('guild-123', 'leader-456', 'Valorant', 60);
    });

    it('should extend lobby time', () => {
      const originalExpiry = new Date(lobby.expiresAt);
      expect(lobby.extend(30)).toBe(true);
      
      const newExpiry = new Date(lobby.expiresAt);
      const timeDiff = newExpiry.getTime() - originalExpiry.getTime();
      expect(timeDiff).toBe(30 * 60 * 1000); // 30 minutes in ms
    });

    it('should not extend inactive lobby', () => {
      lobby.disband();
      expect(lobby.extend(30)).toBe(false);
    });

    it('should calculate time remaining correctly', () => {
      // Set expiry to 30 minutes from now
      lobby.expiresAt = new Date(Date.now() + (30 * 60 * 1000)).toISOString();
      const remaining = lobby.getTimeRemaining();
      
      expect(remaining).toBeGreaterThan(29);
      expect(remaining).toBeLessThanOrEqual(30);
    });

    it('should return 0 for expired lobby', () => {
      lobby.expiresAt = new Date(Date.now() - 1000).toISOString();
      expect(lobby.getTimeRemaining()).toBe(0);
    });
  });

  describe('toDatabase', () => {
    it('should convert to database format', () => {
      const lobby = Lobby.create('guild-123', 'leader-456', 'Valorant');
      const dbData = lobby.toDatabase();

      expect(dbData).toHaveProperty('id');
      expect(dbData).toHaveProperty('guild_id', 'guild-123');
      expect(dbData).toHaveProperty('leader_id', 'leader-456');
      expect(dbData).toHaveProperty('game_type', 'Valorant');
      expect(dbData).toHaveProperty('status', 'active');
      expect(dbData).toHaveProperty('created_at');
      expect(dbData).toHaveProperty('expires_at');
    });
  });

  describe('display methods', () => {
    it('should generate display name', () => {
      const lobby = new Lobby({ gameType: 'Valorant' });
      expect(lobby.getDisplayName()).toBe('Valorant Lobby');
    });
  });
});