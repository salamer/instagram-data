import {
  Post,
  Delete,
  Route,
  Tags,
  Security,
  Request,
  Path,
  Controller,
  Res,
  TsoaResponse,
  Get,
  SuccessResponse,
} from 'tsoa';
import { AppDataSource, User, Follow, Posts as PostItem, Like } from './models';
import type { JwtPayload } from './utils';
import { PostResponse } from './post.controller';
import { In } from 'typeorm';
import { getCurrentUser } from './auth.middleware';

interface UserProfileResponse {
  id: number;
  username: string;
  bio: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  followers: number;
  following: number;
  hasFollowed: boolean;
}

@Route('users')
@Tags('Users & Follows')
export class UserController extends Controller {
  // @Security('jwt')
  @SuccessResponse(200, 'Followed')
  @Post('{userIdToFollow}/follow')
  public async followUser(
    @Request() req: Express.Request,
    @Path() userIdToFollow: number,
    @Res() notFound: TsoaResponse<404, { message: string }>,
    @Res() conflict: TsoaResponse<409, { message: string }>,
    @Res() badRequest: TsoaResponse<400, { message: string }>,
  ): Promise<{ message: string }> {
    // const currentUser = req.user as JwtPayload;
    const currentUser = getCurrentUser();

    if (currentUser.userId === userIdToFollow) {
      return badRequest(400, { message: 'You cannot follow yourself.' });
    }

    const userToFollow = await AppDataSource.getRepository(User).findOneBy({
      id: userIdToFollow,
    });
    if (!userToFollow) {
      return notFound(404, { message: 'User to follow not found.' });
    }

    const followRepo = AppDataSource.getRepository(Follow);
    const exists = await followRepo.findOneBy({
      followerId: currentUser.userId,
      followedId: userIdToFollow,
    });

    if (exists) {
      return conflict(409, { message: 'You are already following this user.' });
    }

    const newFollow = followRepo.create({
      followerId: currentUser.userId,
      followedId: userIdToFollow,
    });

    await followRepo.save(newFollow);
    this.setStatus(200);
    return { message: `Successfully followed user ${userIdToFollow}` };
  }

  // @Security('jwt')
  @SuccessResponse(200, 'Unfollowed')
  @Delete('{userIdToUnfollow}/unfollow')
  public async unfollowUser(
    @Request() req: Express.Request,
    @Path() userIdToUnfollow: number,
    @Res() notFound: TsoaResponse<404, { message: string }>,
  ): Promise<{ message: string }> {
    // const currentUser = req.user as JwtPayload;
    const currentUser = getCurrentUser();

    const result = await AppDataSource.getRepository(Follow).delete({
      followerId: currentUser.userId,
      followedId: userIdToUnfollow,
    });

    if (result.affected === 0) {
      return notFound(404, { message: 'Follow relationship not found.' });
    }

    return { message: `Successfully unfollowed user ${userIdToUnfollow}` };
  }

  // @Security('jwt', ['optional'])
  @Get('{userId}/profile')
  public async getUserProfile(
    @Request() req: Express.Request,
    @Path() userId: number,
    @Res() notFound: TsoaResponse<404, { message: string }>,
  ): Promise<UserProfileResponse> {
    const userRepo = AppDataSource.getRepository(User);
    const followRepo = AppDataSource.getRepository(Follow);

    const user = await userRepo.findOneBy({ id: userId });
    if (!user) {
      return notFound(404, { message: 'User not found' });
    }

    const followers = await followRepo.count({ where: { followedId: userId } });
    const following = await followRepo.count({ where: { followerId: userId } });

    // const currentUser = req.user as JwtPayload;
    const currentUser = getCurrentUser();
    const hasFollowed =
      currentUser && currentUser.userId
        ? await followRepo.findOne({
            where: {
              followerId: currentUser.userId,
              followedId: userId,
            },
          })
        : null;

    return {
      id: user.id,
      username: user.username,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
      followers,
      following,
      hasFollowed: hasFollowed ? true : false,
    };
  }

  @Get('{userId}/followers')
  public async getUserFollowers(
    @Path() userId: number,
    @Res() notFound: TsoaResponse<404, { message: string }>,
  ): Promise<UserProfileResponse[]> {
    const followRepo = AppDataSource.getRepository(Follow);
    const userRepo = AppDataSource.getRepository(User);

    const followers = await followRepo.find({
      where: { followedId: userId },
      relations: ['follower'],
    });

    if (followers.length === 0) {
      return notFound(404, { message: 'No followers found for this user.' });
    }

    // Add a check to avoid null/undefined `follower`
    const followerProfiles = followers
      .map((follow) => {
        if (!follow.follower) {
          console.error(
            `Follower not found for follow entry with ID ${follow.id}`,
          );
          return null; // or handle the error appropriately
        }

        return {
          id: follow.follower.id,
          username: follow.follower.username,
          bio: follow.follower.bio,
          avatarUrl: follow.follower.avatarUrl,
          createdAt: follow.follower.createdAt,
          followers: 0, // Followers count not available in this context
          following: 0, // Following count not available in this context
          hasFollowed: false, // Follow status not available in this context
        };
      })
      .filter((profile) => profile !== null); // Filter out any null entries

    return followerProfiles;
  }

  @Get('{userId}/following')
  public async getUserFollowing(
    @Path() userId: number,
  ): Promise<UserProfileResponse[]> {
    const followRepo = AppDataSource.getRepository(Follow);
    const userRepo = AppDataSource.getRepository(User);

    const following = await followRepo.find({
      where: { followerId: userId },
      relations: ['followed'],
    });

    if (following.length === 0) {
      return [];
    }

    return following
      .filter((follow) => follow.followed !== null)
      .map((follow) => ({
        id: follow.followed.id,
        username: follow.followed.username,
        bio: follow.followed.bio,
        avatarUrl: follow.followed.avatarUrl,
        createdAt: follow.followed.createdAt,
        followers: 0, // Followers count not available in this context
        following: 0, // Following count not available in this context
        hasFollowed: false, // Follow status not available in this context
      }));
  }

  @Get('{userId}/posts')
  // @Security('jwt', ['optional'])
  public async getUserPosts(
    @Request() req: Express.Request,
    @Path() userId: number,
  ): Promise<PostResponse[]> {
    const user = await AppDataSource.getRepository(User).findOneBy({
      id: userId,
    });
    if (!user) {
      return []; // or throw an error if preferred
    }

    const posts = await AppDataSource.getRepository(PostItem).find({
      where: { userId },
      relations: ['user'],
    });

    // const currentUser = req.user as JwtPayload;
    const currentUser = getCurrentUser();
    const likes =
      currentUser && currentUser.userId
        ? await AppDataSource.getRepository(Like).find({
            where: [
              {
                userId: currentUser.userId,
                postId: In(posts.map((post) => post.id)),
              },
            ],
          })
        : [];

    return posts.map((post) => ({
      id: post.id,
      imageUrl: post.imageUrl,
      caption: post.caption,
      createdAt: post.createdAt,
      userId: post.userId,
      username: post.user?.username || 'unknown',
      avatarUrl: post.user?.avatarUrl || null,
      hasLiked: likes.some((like) => like.id === post.id),
    }));
  }

  @Get('{userId}/likes')
  // @Security('jwt', ['optional'])
  public async getUserLikes(
    @Request() req: Express.Request,
    @Path() userId: number,
  ): Promise<PostResponse[]> {
    const user = await AppDataSource.getRepository(User).findOneBy({
      id: userId,
    });
    if (!user) {
      return [];
    }

    const posts = await AppDataSource.getRepository(Like).find({
      where: { userId },
      relations: ['user', 'post'],
    });

    // const currentUser = req.user as JwtPayload;
    const currentUser = getCurrentUser();
    const likes =
      currentUser && currentUser.userId
        ? await AppDataSource.getRepository(Like).find({
            where: [
              {
                userId: currentUser.userId,
                postId: In(posts.map((p) => p.id)),
              },
            ],
          })
        : [];

    return posts
      .filter((post) => post.user !== null && post.post !== null)
      .map((post) => ({
        id: post.id,
        imageUrl: post.post.imageUrl,
        caption: post.post.caption,
        createdAt: post.createdAt,
        userId: post.userId,
        username: post.user?.username || 'unknown',
        avatarUrl: post.user?.avatarUrl || null,
        hasLiked: likes.some((like) => like.id === post.id),
      }));
  }
}
