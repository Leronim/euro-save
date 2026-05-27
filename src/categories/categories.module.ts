import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CategoriesService } from './categories.service';

@Module({
  imports: [PrismaModule],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
